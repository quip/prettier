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

export class ModelContact extends SyncerContact {
    /** @override */
    displayTitle(): string | null {
        const user = this.user();
        return user ? user.getName() : null;
    }

    user(): ModelUser {
        return this.hasUserId()
            ? ModelUser.get((this.getUserId() as unknown) as string)
            : null;
    }

    thread(): ModelThread {
        return this.getThreadId()
            ? ModelThread.get((this.getThreadId() as unknown) as string)
            : null;
    }

    remove() {
        ModelSyncer.instance.callHandler(
            new RemoveContactPb.Request().setContactId(this.id()));
    }

    /** @override */
    static type(): IdTypePb {
        return IdTypePb.CONTACT;
    }

    static get = objectClass.getterFn(ModelContact);

    static allContacts: () => ModelContactIndex = ModelIndex.newSimpleIndexGetter(
        "Contact/affinity",
        ModelContact);

    static recentContacts: () => ModelContactIndex = ModelIndex.newSimpleIndexGetter(
        "Contact/recent",
        ModelContact);

    static siteContacts: () => ModelContactIndex = ModelIndex.newSimpleIndexGetter(
        "Contact/site",
        ModelContact);

    static sharingContacts: () => ModelContactIndex = ModelIndex.newSimpleIndexGetter(
        "Contact/sharing",
        ModelContact);

    static siteInviteContacts: () => ModelContactIndex = ModelIndex.newSimpleIndexGetter(
        "Contact/siteInvite",
        ModelContact);

    static relevantContacts(): ModelContactIndex {
        if (ModelUser.currentUser().company()) {
            return ModelContact.siteContacts();
        }
        return ModelContact.allContacts();
    }

    static relevantSharingContacts(): ModelContactIndex {
        if (ModelUser.currentUser().company()) {
            return ModelContact.sharingContacts();
        }
        return ModelContact.allContacts();
    }

    static getByIdWithFn(
        fn: (arg0: string, arg1: (arg0: string) => any) => any,
        objId: string,
        callback?: (arg0: ModelContact) => any
    ): Promise<ModelContact | null> {
        return new Promise(resolve => {
            fn(objId, contactId => {
                const result = contactId ? ModelContact.get(contactId) : null;
                if (callback) {
                    callback(result);
                }
                const loadedResult = (result &&
                    (result.load() as unknown)) as null | Promise<ModelContact>;
                resolve(loadedResult);
            });
        });
    }

    static getByUserId(
        userId: string,
        callback?: (arg0: ModelContact) => any
    ): Promise<ModelContact | null> {
        const acInstance = autocomplete.instance();
        return this.getByIdWithFn(
            acInstance.getContactIdByUserId.bind(acInstance),
            userId,
            callback);
    }

    static getByChatThreadId(
        threadId: string,
        callback?: (arg0: ModelContact) => any
    ): Promise<ModelContact | null> {
        const acInstance = autocomplete.instance();
        return this.getByIdWithFn(
            acInstance.getContactIdByChatThreadId.bind(acInstance),
            threadId,
            callback);
    }
}

@mixin(PureRenderMixin, IsMountedMixin, ListenerMixin)
export class FocusButton
    extends React.Component<FocusButtonProps, FocusButtonState>
    implements
        MixedIn<PureRenderMixin>,
        MixedIn<IsMountedMixin>,
        MixedIn<ListenerMixin> {
    private dimTimeout_: number | null = null;
    private mouseMoveListenable_: EventListenable<(arg0: Event) => any>;

    constructor(props: FocusButtonProps, context?: any) {
        super(props, context);
        deprecatedBindMethodsToInstance(this);
        this.mouseMoveListenable_ = new EventListenable(window, "mousemove");
        this.state = this.initialState();
    }

    initialState(): FocusButtonState {
        return {dimmed: false};
    }

    private unDim_() {
        if (this.dimTimeout_) {
            loop.clearTimeout(this.dimTimeout_);
            this.dimTimeout_ = null;
        }
        this.setState({dimmed: false});
        this.dimTimeout_ = loop.setTimeout(
            this.mountedCallback(() => {
                this.setState({dimmed: true});
            }),
            FocusButton.DIM_FOCUS_TIMEOUT);
    }

    /** @override */
    componentWillMount() {
        this.unDim_();
    }

    private toggleFocused_(e: Event) {
        const {focusMode, setFocusMode} = this.props;
        setFocusMode(!focusMode);
    }

    /** @override */
    render() {
        const {dimmed} = this.state;
        const {focusMode, global} = this.props;
        return <StandardButton
            backgroundColor={Color.white}
            ariaLabel={focusMode ? _("Leave Focus Mode") : _("Focus Mode")}
            tooltipKeyboardShortcut={
                new ShortcutDesc(
                    KeyCode.M,
                    ShortcutModifier.MOD | ShortcutModifier.SHIFT)
            }
            icon={focusMode ? ExitFullScreenIcon : FullScreen24Icon}
            className={partsClassList.of("focus-button", {
                "dimmed": dimmed,
                "global": global
            })}
            selected={focusMode}
            onClick={this.toggleFocused_}/>;
    }

    /** @override */
    protected getListenables(
        props: FocusButtonProps,
        state: FocusButtonState | null
    ): Listenables {
        const {dimmed} = state;
        return dimmed ? [[this.mouseMoveListenable_, this.unDim_]] : [];
    }

    static readonly DIM_FOCUS_TIMEOUT: number = 5000;

    // IsMountedMixin
    @mixedIn
    deprecatedIsMounted: () => boolean;

    @mixedIn
    mountedCallback: <A, R>(
        fn: (...arg0: A[]) => R
    ) => (...arg0: A[]) => R | undefined;
}
