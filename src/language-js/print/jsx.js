"use strict";

const { printComments, printDanglingComments } = require("../../main/comments");
const {
  builders: {
    concat,
    line,
    hardline,
    softline,
    group,
    indent,
    conditionalGroup,
    fill,
    ifBreak,
    lineSuffixBoundary,
  },
  utils: { willBreak, isLineNext, isEmpty },
} = require("../../document");

const { getLast, getPreferredQuote } = require("../../common/util");
const {
  hasTrailingComment,
  isEmptyJSXElement,
  isJSXWhitespaceExpression,
  isJSXNode,
  isMeaningfulJSXText,
  matchJsxWhitespaceRegex,
  rawText,
  isLiteral,
  isCallOrOptionalCallExpression,
  isStringLiteral,
  isBinaryish,
  isBlockComment,
} = require("../utils");
const pathNeedsParens = require("../needs-parens");
const { willPrintOwnComments } = require("../comments");

// JSX expands children from the inside-out, instead of the outside-in.
// This is both to break children before attributes,
// and to ensure that when children break, their parents do as well.
//
// Any element that is written without any newlines and fits on a single line
// is left that way.
// Not only that, any user-written-line containing multiple JSX siblings
// should also be kept on one line if possible,
// so each user-written-line is wrapped in its own group.
//
// Elements that contain newlines or don't fit on a single line (recursively)
// are fully-split, using hardline and shouldBreak: true.
//
// To support that case properly, all leading and trailing spaces
// are stripped from the list of children, and replaced with a single hardline.
function printJsxElementInternal(path, options, print) {
  const n = path.getValue();

  if (n.type === "JSXElement" && isEmptyJSXElement(n)) {
    return concat([
      path.call(print, "openingElement"),
      path.call(print, "closingElement"),
    ]);
  }

  const openingLines =
    n.type === "JSXElement"
      ? path.call(print, "openingElement")
      : path.call(print, "openingFragment");
  const closingLines =
    n.type === "JSXElement"
      ? path.call(print, "closingElement")
      : path.call(print, "closingFragment");

  if (
    n.children.length === 1 &&
    n.children[0].type === "JSXExpressionContainer" &&
    (n.children[0].expression.type === "TemplateLiteral" ||
      n.children[0].expression.type === "TaggedTemplateExpression")
  ) {
    return concat([
      openingLines,
      concat(path.map(print, "children")),
      closingLines,
    ]);
  }

  // Convert `{" "}` to text nodes containing a space.
  // This makes it easy to turn them into `jsxWhitespace` which
  // can then print as either a space or `{" "}` when breaking.
  n.children = n.children.map((child) => {
    if (isJSXWhitespaceExpression(child)) {
      return {
        type: "JSXText",
        value: " ",
        raw: " ",
      };
    }
    return child;
  });

  const containsTag = n.children.filter(isJSXNode).length > 0;
  const containsMultipleExpressions =
    n.children.filter((child) => child.type === "JSXExpressionContainer")
      .length > 1;
  const containsMultipleAttributes =
    n.type === "JSXElement" && n.openingElement.attributes.length > 1;

  // Record any breaks. Should never go from true to false, only false to true.
  let forcedBreak =
    willBreak(openingLines) ||
    containsTag ||
    containsMultipleAttributes ||
    containsMultipleExpressions;

  const isMdxBlock = path.getParentNode().rootMarker === "mdx";

  const rawJsxWhitespace = options.singleQuote ? "{' '}" : '{" "}';
  const jsxWhitespace = isMdxBlock
    ? concat([" "])
    : ifBreak(concat([rawJsxWhitespace, softline]), " ");

  const isFacebookTranslationTag =
    n.openingElement &&
    n.openingElement.name &&
    n.openingElement.name.name === "fbt";

  const children = printJSXChildren(
    path,
    options,
    print,
    jsxWhitespace,
    isFacebookTranslationTag
  );

  const containsText = n.children.some((child) => isMeaningfulJSXText(child));

  // We can end up we multiple whitespace elements with empty string
  // content between them.
  // We need to remove empty whitespace and softlines before JSX whitespace
  // to get the correct output.
  for (let i = children.length - 2; i >= 0; i--) {
    const isPairOfEmptyStrings = children[i] === "" && children[i + 1] === "";
    const isPairOfHardlines =
      children[i] === hardline &&
      children[i + 1] === "" &&
      children[i + 2] === hardline;
    const isLineFollowedByJSXWhitespace =
      (children[i] === softline || children[i] === hardline) &&
      children[i + 1] === "" &&
      children[i + 2] === jsxWhitespace;
    const isJSXWhitespaceFollowedByLine =
      children[i] === jsxWhitespace &&
      children[i + 1] === "" &&
      (children[i + 2] === softline || children[i + 2] === hardline);
    const isDoubleJSXWhitespace =
      children[i] === jsxWhitespace &&
      children[i + 1] === "" &&
      children[i + 2] === jsxWhitespace;
    const isPairOfHardOrSoftLines =
      (children[i] === softline &&
        children[i + 1] === "" &&
        children[i + 2] === hardline) ||
      (children[i] === hardline &&
        children[i + 1] === "" &&
        children[i + 2] === softline);

    if (
      (isPairOfHardlines && containsText) ||
      isPairOfEmptyStrings ||
      isLineFollowedByJSXWhitespace ||
      isDoubleJSXWhitespace ||
      isPairOfHardOrSoftLines
    ) {
      children.splice(i, 2);
    } else if (isJSXWhitespaceFollowedByLine) {
      children.splice(i + 1, 2);
    }
  }

  // Trim trailing lines (or empty strings)
  while (
    children.length &&
    (isLineNext(getLast(children)) || isEmpty(getLast(children)))
  ) {
    children.pop();
  }

  // Trim leading lines (or empty strings)
  while (
    children.length &&
    (isLineNext(children[0]) || isEmpty(children[0])) &&
    (isLineNext(children[1]) || isEmpty(children[1]))
  ) {
    children.shift();
    children.shift();
  }

  // Tweak how we format children if outputting this element over multiple lines.
  // Also detect whether we will force this element to output over multiple lines.
  const multilineChildren = [];
  children.forEach((child, i) => {
    // There are a number of situations where we need to ensure we display
    // whitespace as `{" "}` when outputting this element over multiple lines.
    if (child === jsxWhitespace) {
      if (i === 1 && children[i - 1] === "") {
        if (children.length === 2) {
          // Solitary whitespace
          multilineChildren.push(rawJsxWhitespace);
          return;
        }
        // Leading whitespace
        multilineChildren.push(concat([rawJsxWhitespace, hardline]));
        return;
      } else if (i === children.length - 1) {
        // Trailing whitespace
        multilineChildren.push(rawJsxWhitespace);
        return;
      } else if (children[i - 1] === "" && children[i - 2] === hardline) {
        // Whitespace after line break
        multilineChildren.push(rawJsxWhitespace);
        return;
      }
    }

    multilineChildren.push(child);

    if (willBreak(child)) {
      forcedBreak = true;
    }
  });

  // If there is text we use `fill` to fit as much onto each line as possible.
  // When there is no text (just tags and expressions) we use `group`
  // to output each on a separate line.
  const content = containsText
    ? fill(multilineChildren)
    : group(concat(multilineChildren), { shouldBreak: true });

  if (isMdxBlock) {
    return content;
  }

  const multiLineElem = group(
    concat([
      openingLines,
      indent(concat([hardline, content])),
      hardline,
      closingLines,
    ])
  );

  if (forcedBreak) {
    return multiLineElem;
  }

  return conditionalGroup([
    group(concat([openingLines, concat(children), closingLines])),
    multiLineElem,
  ]);
}

// JSX Children are strange, mostly for two reasons:
// 1. JSX reads newlines into string values, instead of skipping them like JS
// 2. up to one whitespace between elements within a line is significant,
//    but not between lines.
//
// Leading, trailing, and lone whitespace all need to
// turn themselves into the rather ugly `{' '}` when breaking.
//
// We print JSX using the `fill` doc primitive.
// This requires that we give it an array of alternating
// content and whitespace elements.
// To ensure this we add dummy `""` content elements as needed.
function printJSXChildren(
  path,
  options,
  print,
  jsxWhitespace,
  isFacebookTranslationTag
) {
  const n = path.getValue();
  const children = [];

  path.each((childPath, i) => {
    const child = childPath.getValue();
    if (isLiteral(child)) {
      const text = rawText(child);

      // Contains a non-whitespace character
      if (isMeaningfulJSXText(child)) {
        const words = text.split(matchJsxWhitespaceRegex);

        // Starts with whitespace
        if (words[0] === "") {
          children.push("");
          words.shift();
          if (/\n/.test(words[0])) {
            const next = n.children[i + 1];
            children.push(
              separatorWithWhitespace(
                isFacebookTranslationTag,
                words[1],
                child,
                next
              )
            );
          } else {
            children.push(jsxWhitespace);
          }
          words.shift();
        }

        let endWhitespace;
        // Ends with whitespace
        if (getLast(words) === "") {
          words.pop();
          endWhitespace = words.pop();
        }

        // This was whitespace only without a new line.
        if (words.length === 0) {
          return;
        }

        words.forEach((word, i) => {
          if (i % 2 === 1) {
            children.push(line);
          } else {
            children.push(word);
          }
        });

        if (endWhitespace !== undefined) {
          if (/\n/.test(endWhitespace)) {
            const next = n.children[i + 1];
            children.push(
              separatorWithWhitespace(
                isFacebookTranslationTag,
                getLast(children),
                child,
                next
              )
            );
          } else {
            children.push(jsxWhitespace);
          }
        } else {
          const next = n.children[i + 1];
          children.push(
            separatorNoWhitespace(
              isFacebookTranslationTag,
              getLast(children),
              child,
              next
            )
          );
        }
      } else if (/\n/.test(text)) {
        // Keep (up to one) blank line between tags/expressions/text.
        // Note: We don't keep blank lines between text elements.
        if (text.match(/\n/g).length > 1) {
          children.push("");
          children.push(hardline);
        }
      } else {
        children.push("");
        children.push(jsxWhitespace);
      }
    } else {
      const printedChild = print(childPath);
      children.push(printedChild);

      const next = n.children[i + 1];
      const directlyFollowedByMeaningfulText =
        next && isMeaningfulJSXText(next);
      if (directlyFollowedByMeaningfulText) {
        const firstWord = rawText(next)
          .trim()
          .split(matchJsxWhitespaceRegex)[0];
        children.push(
          separatorNoWhitespace(
            isFacebookTranslationTag,
            firstWord,
            child,
            next
          )
        );
      } else {
        children.push(hardline);
      }
    }
  }, "children");

  return children;
}

function separatorNoWhitespace(
  isFacebookTranslationTag,
  child,
  childNode,
  nextNode
) {
  if (isFacebookTranslationTag) {
    return "";
  }

  if (
    (childNode.type === "JSXElement" && !childNode.closingElement) ||
    (nextNode && nextNode.type === "JSXElement" && !nextNode.closingElement)
  ) {
    return child.length === 1 ? softline : hardline;
  }

  return softline;
}

function separatorWithWhitespace(
  isFacebookTranslationTag,
  child,
  childNode,
  nextNode
) {
  if (isFacebookTranslationTag) {
    return hardline;
  }

  if (child.length === 1) {
    return (childNode.type === "JSXElement" && !childNode.closingElement) ||
      (nextNode && nextNode.type === "JSXElement" && !nextNode.closingElement)
      ? hardline
      : softline;
  }

  return hardline;
}

function maybeWrapJSXElementInParens(path, elem, options) {
  const parent = path.getParentNode();
  /* istanbul ignore next */
  if (!parent) {
    return elem;
  }

  const NO_WRAP_PARENTS = {
    ArrayExpression: true,
    JSXAttribute: true,
    JSXElement: true,
    JSXExpressionContainer: true,
    JSXFragment: true,
    ExpressionStatement: true,
    CallExpression: true,
    OptionalCallExpression: true,
    ConditionalExpression: true,
    JsExpressionRoot: true,
  };
  if (NO_WRAP_PARENTS[parent.type]) {
    return elem;
  }

  const shouldBreak = path.match(
    undefined,
    (node) => node.type === "ArrowFunctionExpression",
    isCallOrOptionalCallExpression,
    (node) => node.type === "JSXExpressionContainer"
  );

  const needsParens = pathNeedsParens(path, options);

  return group(
    concat([
      needsParens ? "" : ifBreak("("),
      indent(concat([softline, elem])),
      softline,
      needsParens ? "" : ifBreak(")"),
    ]),
    { shouldBreak }
  );
}

function printJsxAttribute(path, options, print) {
  const n = path.getValue();
  const parts = [];
  parts.push(path.call(print, "name"));

  if (n.value) {
    let res;
    if (isStringLiteral(n.value)) {
      const raw = rawText(n.value);
      // Unescape all quotes so we get an accurate preferred quote
      let final = raw.replace(/&apos;/g, "'").replace(/&quot;/g, '"');
      const quote = getPreferredQuote(
        final,
        options.jsxSingleQuote ? "'" : '"'
      );
      const escape = quote === "'" ? "&apos;" : "&quot;";
      final = final.slice(1, -1).replace(new RegExp(quote, "g"), escape);
      res = concat([quote, final, quote]);
    } else {
      res = path.call(print, "value");
    }
    parts.push("=", res);
  }

  return concat(parts);
}

function printJsxExpressionContainer(path, options, print) {
  const n = path.getValue();
  const parent = path.getParentNode(0);

  const hasComments = n.expression.comments && n.expression.comments.length > 0;

  const shouldInline =
    n.expression.type === "JSXEmptyExpression" ||
    (!hasComments &&
      (n.expression.type === "ArrayExpression" ||
        n.expression.type === "ObjectExpression" ||
        n.expression.type === "ArrowFunctionExpression" ||
        n.expression.type === "CallExpression" ||
        n.expression.type === "OptionalCallExpression" ||
        n.expression.type === "FunctionExpression" ||
        n.expression.type === "TemplateLiteral" ||
        n.expression.type === "TaggedTemplateExpression" ||
        n.expression.type === "DoExpression" ||
        (isJSXNode(parent) &&
          (n.expression.type === "ConditionalExpression" ||
            isBinaryish(n.expression)))));

  if (shouldInline) {
    return group(
      concat(["{", path.call(print, "expression"), lineSuffixBoundary, "}"])
    );
  }

  return group(
    concat([
      "{",
      indent(concat([softline, path.call(print, "expression")])),
      softline,
      lineSuffixBoundary,
      "}",
    ])
  );
}

function printJsxOpeningElement(path, options, print) {
  const n = path.getValue();

  const nameHasComments =
    (n.name && n.name.comments && n.name.comments.length > 0) ||
    (n.typeParameters &&
      n.typeParameters.comments &&
      n.typeParameters.comments.length > 0);

  // Don't break self-closing elements with no attributes and no comments
  const space = options.jsxBracketSameLine ? "" : " ";
  if (n.selfClosing && !n.attributes.length && !nameHasComments) {
    return concat([
      "<",
      path.call(print, "name"),
      path.call(print, "typeParameters"),
      space + "/>",
    ]);
  }

  // don't break up opening elements with a single long text attribute
  if (
    n.attributes &&
    n.attributes.length === 1 &&
    n.attributes[0].value &&
    isStringLiteral(n.attributes[0].value) &&
    !n.attributes[0].value.value.includes("\n") &&
    // We should break for the following cases:
    // <div
    //   // comment
    //   attr="value"
    // >
    // <div
    //   attr="value"
    //   // comment
    // >
    !nameHasComments &&
    (!n.attributes[0].comments || !n.attributes[0].comments.length)
  ) {
    return group(
      concat([
        "<",
        path.call(print, "name"),
        path.call(print, "typeParameters"),
        " ",
        concat(path.map(print, "attributes")),
        n.selfClosing ? space + "/>" : ">",
      ])
    );
  }

  const lastAttrHasTrailingComments =
    n.attributes.length && hasTrailingComment(getLast(n.attributes));

  const bracketSameLine =
    // Simple tags (no attributes and no comment in tag name) should be
    // kept unbroken regardless of `jsxBracketSameLine`
    (!n.attributes.length && !nameHasComments) ||
    (options.jsxBracketSameLine &&
      // We should print the bracket in a new line for the following cases:
      // <div
      //   // comment
      // >
      // <div
      //   attr // comment
      // >
      (!nameHasComments || n.attributes.length) &&
      !lastAttrHasTrailingComments);

  // We should print the opening element expanded if any prop value is a
  // string literal with newlines
  const shouldBreak =
    n.attributes &&
    n.attributes.some(
      (attr) =>
        attr.value &&
        isStringLiteral(attr.value) &&
        attr.value.value.includes("\n")
    );

  return group(
    concat([
      "<",
      path.call(print, "name"),
      path.call(print, "typeParameters"),
      concat([
        indent(
          concat(path.map((attr) => concat([line, print(attr)]), "attributes"))
        ),
        bracketSameLine ? (n.selfClosing ? "/>" : ">") : softline,
      ]),
      bracketSameLine ? "" : n.selfClosing ? "/>" : ">",
    ]),
    { shouldBreak }
  );
}

function printJsxClosingElement(path, options, print) {
  return concat(["</", path.call(print, "name"), ">"]);
}

function printJsxOpeningClosingFragment(path, options /*, print*/) {
  const n = path.getValue();
  const hasComment = n.comments && n.comments.length;
  const hasOwnLineComment =
    hasComment && !n.comments.every((comment) => isBlockComment(comment));
  const isOpeningFragment = n.type === "JSXOpeningFragment";
  return concat([
    isOpeningFragment ? "<" : "</",
    indent(
      concat([
        hasOwnLineComment
          ? hardline
          : hasComment && !isOpeningFragment
          ? " "
          : "",
        printDanglingComments(path, options, true),
      ])
    ),
    hasOwnLineComment ? hardline : "",
    ">",
  ]);
}

function printJsxElement(path, options, print) {
  const elem = printComments(
    path,
    () => printJsxElementInternal(path, options, print),
    options
  );
  return maybeWrapJSXElementInParens(path, elem, options);
}

function printJsxEmptyExpression(path, options /*, print*/) {
  const n = path.getValue();
  const requiresHardline =
    n.comments && !n.comments.every((comment) => isBlockComment(comment));

  return concat([
    printDanglingComments(path, options, /* sameIndent */ !requiresHardline),
    requiresHardline ? hardline : "",
  ]);
}

// `JSXSpreadAttribute` and `JSXSpreadChild`
function printJsxSpreadAttribute(path, options, print) {
  const n = path.getValue();
  return concat([
    "{",
    path.call(
      (p) => {
        const printed = concat(["...", print(p)]);
        const n = p.getValue();
        if (!n.comments || !n.comments.length || !willPrintOwnComments(p)) {
          return printed;
        }
        return concat([
          indent(concat([softline, printComments(p, () => printed, options)])),
          softline,
        ]);
      },
      n.type === "JSXSpreadAttribute" ? "argument" : "expression"
    ),
    "}",
  ]);
}

module.exports = {
  printJsxElement,
  printJsxAttribute,
  printJsxOpeningElement,
  printJsxClosingElement,
  printJsxOpeningClosingFragment,
  printJsxExpressionContainer,
  printJsxEmptyExpression,
  printJsxSpreadAttribute,
  // Alias
  printJsxSpreadChild: printJsxSpreadAttribute,
};
