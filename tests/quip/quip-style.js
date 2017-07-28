if (activeObject instanceof model.Folder) {
  // aoeu
}
if (activeObject instanceof model.Folder &&
        (activeObject.isStandardFolder() ||
        activeObject.isArchiveFolder() ||
        activeObject.isDesktopFolder() ||
        activeObject.isWorkgroupFolder() ||
        activeObject.isRootPersonalFolder())) {
    folderId = activeObject.id();
}


/** @override */
elements.client.editor.PlatformDocument.prototype.save = function(
      title, updateBundle, successCallback, errorCallback, synchronous) {
  shortcuts.add(
      events.KeyCode.R,
      shortcuts.Modifier.MOD,
      base.bind(function(target) {
          this.refreshFromServer_();
          return true;
      }, this));
  var slide = doc.createNewSectionAfter(
      beforeSection,
      proto.section.Section.Style.SLIDE_STYLE,
      true); // after root container
      var slashShortcutDesc = new shortcuts.Desc(
          events.KeyCode.FORWARD_SLASH, shortcuts.Modifier.NONE);

}
