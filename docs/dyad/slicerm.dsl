system SliceRM {
  region: browser
  event-naming: none
  external: RequirementToSlice (translator), SliceDeletedToFlows (translator), SliceToRequirement (translator), SliceDeletedToRequirements (translator), LinksToCoverage (translator)
}

actor Person { auth: session }
actor Reviewer { auth: session }
actor System { auth: session }
actor Sponsor { auth: session }
actor Agent { auth: session }

boundary Account(organizationId) @partition(shardKey="organizationId")
boundary Project(projectId) @partition(shardKey="projectId")
boundary Slice(sliceId) @partition(shardKey="sliceId")
boundary DraftScore(draftScoreId) @partition(shardKey="draftScoreId")
boundary Flow(flowId) @partition(shardKey="flowId")
boundary Requirement(requirementId) @partition(shardKey="requirementId")
boundary Coverage(projectId) @partition(shardKey="projectId")
boundary Plan(planItemId) @partition(shardKey="planItemId")
boundary Review(projectId) @partition(shardKey="projectId")
boundary Spec(specId) @partition(shardKey="specId")
boundary Build(buildId) @partition(shardKey="buildId")
boundary Persona(personaId) @partition(shardKey="personaId")
boundary Pass(passId) @partition(shardKey="passId")
boundary Session(sessionId) @partition(shardKey="sessionId")
boundary Claim(workId) @partition(shardKey="workId")
boundary Proposal(proposalId) @partition(shardKey="proposalId")

context Identity {
  description: Who someone is, and which accounts they belong to.

  view AccountDetails(id: id) = [AccountCreated, EmailVerified] => { name: text, email: text, verified: yesno } @note("Person uses AccountPage") @slice("See my account") @story("As a Person, I want to see my account, so that I can see name, email and verified.")

  Person -> signUp(name: text, email: text) in Account(accountId) @note("Person uses SignUpPage") @slice("Sign up") @note("A mock today. Nothing here is real security until there's a backend.") @story("As a Person, I want to sign up, so that the account is created.")
    --[an account with this email already exists]--> reject EMAIL_TAKEN
    --[the password has fewer than eight characters]--> reject PASSWORD_SHORT
    --[default]--> [AccountCreated { accountId: id, email: text }]

  Person -> verifyEmail(code: text) in Account(accountId) @note("Person uses VerifyEmailPage") @slice("Verify an email") @story("As a Person, I want to verify an email, so that the email is verified.")
    --[the code doesn’t match the one sent]--> reject BAD_CODE
    --[default]--> [EmailVerified { accountId: id }]

  Person -> signIn(email: text) in Account(accountId) @note("Person uses SignInPage") @slice("Sign in") @note("Passwords are never stored by the mock, because people may type real ones.") @story("As a Person, I want to sign in, so that signed in is on record.")
    --[the email and password don’t match an account]--> reject BAD_CREDENTIALS
    --[default]--> [SignedIn { accountId: id }]

  Person -> resetPassword(token: text) in Account(accountId) @note("Person uses ResetPasswordPage") @slice("Reset a password") @story("As a Person, I want to reset a password, so that password reset is on record.")
    --[the reset link has expired or was already used]--> reject BAD_RESET
    --[default]--> [PasswordReset { accountId: id }]

  Person -> saveDomain(name: text) in Account(accountId) @note("Person uses DomainsPanel") @slice("Manage domains") @note("Domains belong to the account, not the project. Everything unassigned is in Default.") @state(model="DomainList", result="the account’s domains are saved") @story("As a Person, I want to manage domains, so that the account’s domains are saved.")
    --[there is already a domain with this name]--> reject DOMAIN_TAKEN
    --[default]--> [DomainSaved { accountId: id, name: text }]

  Person -> setTheme(theme: text) in Account(accountId) @note("Person uses ThemeToggle") @slice("Choose light or dark") @note("Light, dark or matching the device. Saved in this browser, not on the account.") @state(model="ThemePreference", result="the app uses the chosen theme") @story("As a Person, I want to choose light or dark, so that the app uses the chosen theme.")
    --[default]--> [ThemeChosen { accountId: id, theme: text }]

  Person -> setAppearance(preset: text, accent: number, surface: text, headline: text, corners: text) in Account(accountId) @note("Person uses AppearancePanel") @slice("Choose how SliceRM looks") @note("Start from a style (Atelier, Technical, Studio or Bumblebee), then change the accent, headline typeface (eight to choose from), surface, corners, text size, texture and motion, and whether slice headers stay on one line or wrap. Pick any colour and its hue becomes the accent; the Matched surface then takes its tint from it, with every other colour chosen to stay readable. Up to twelve of your own styles can be saved, renamed and deleted, shown beside the built-in ones. Notation keeps its shapes, because they carry meaning. Saved in this browser, not on the account, and downloads follow the colours.") @state(model="AppearancePreference", result="the app uses the chosen look") @story("As a Person, I want to choose how SliceRM looks, so that the app uses the chosen look.")
    --[default]--> [AppearanceChosen { accountId: id, preset: text }]

  Person -> startTour(tourId: text) in Account(accountId) @note("Person uses HelpMenu") @slice("Take a guided tour") @note("Always optional. Only the projects list and the score offer theirs, once each, and offers can be turned off. Every page’s tour, the event modeling basics and the docs are under Help. Saved in this browser, not on the account.") @state(model="ToursSeen", result="the tour isn’t offered again") @story("As a Person, I want to take a guided tour, so that the tour isn’t offered again.")
    --[default]--> [TourTaken { accountId: id, tourId: text }]

  Person -> createOrganization(name: text) in Account(organizationId) @note("Person uses NewOrganizationDialog") @slice("Create an organization") @note("Decided: anyone can work alone, and can create an organization from there.") @planned @story("As a Person, I want to create an organization, so that the organization is created.")
    --[default]--> [OrganizationCreated { organizationId: id, name: text }]

  Person -> inviteMember(email: text, role: text) in Account(organizationId) @note("Person uses MembersPage") @slice("Invite a member") @note("Decided: one login per person, with a membership in each organization. Roles are Owner, Admin, Member and Viewer.") @planned @story("As a Person, I want to invite a member, so that the member is invited.")
    --[default]--> [MemberInvited { organizationId: id, email: text, role: text }]

  Person -> switchAccount(organizationId: id) in Account(organizationId) @note("Person uses AccountSwitcher") @slice("Switch account") @note("Decided: especially for freelancers working with many clients.") @planned @story("As a Person, I want to switch account, so that the account is switched.")
    --[default]--> [AccountSwitched { organizationId: id }]

  Person -> keepEachOrganizationsDataSeparate() @note("Person uses KeepEachOrganizationsDataSeparateTrigger") @slice("Keep each organization’s data separate") @note("Drafted from REQ-150. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [KeepEachOrganizationsDataSeparateRecorded]

  Person -> limitWhoCanSpendOnAI() @note("Person uses LimitWhoCanSpendOnAITrigger") @slice("Limit who can spend on AI") @note("Drafted from REQ-151. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [LimitWhoCanSpendOnAIRecorded]

}

context Workspace {
  description: Projects: creating them, saving them and how they're set up.

  view ProjectShelf(id: id) = [ProjectCreated] => { name: text, mode: text, coverage: number } @note("Person uses ProjectsPage") @slice("Browse projects") @note("From four projects, it can be searched by name or summary, filtered by mode or to samples, and sorted.") @story("As a Person, I want to browse projects, so that I can see name, mode and coverage.")

  Person -> createProject(name: text, mode: text) in Project(projectId) @note("Person uses NewProjectDialog") @slice("Create a project") @story("As a Person, I want to create a project, so that the project is created.")
    --[default]--> [ProjectCreated { projectId: id, name: text, mode: text }]

  Person -> saveProject(projectId: id) in Project(projectId) @note("Person uses ProjectHeader") @slice("Save a project") @note("Refused while any slice uses something defined after it.") @story("As a Person, I want to save a project, so that the project is saved.")
    --[a slice uses something a later slice defines]--> reject OUT_OF_ORDER
    --[default]--> [ProjectSaved { projectId: id, revision: number }]

  Person -> downloadBackup(projectId: id) in Project(projectId) @note("Person uses ExportPage") @slice("Download a backup") @note("The whole project in one file, including unsaved changes. Images stay in the browser that added them; the backup carries their names.") @story("As a Person, I want to download a backup, so that the backup is downloaded.")
    --[default]--> [BackupDownloaded { projectId: id }]

  Person -> importProject(backup: text) in Project(projectId) @note("Person uses ProjectsPage") @slice("Import a project") @note("Always arrives as a new project, so nothing here is overwritten. Older backups are brought up to date on the way in.") @story("As a Person, I want to import a project, so that the project is imported.")
    --[the file isn’t a SliceRM backup, or is damaged]--> reject BACKUP_INVALID
    --[the backup comes from a newer version of SliceRM]--> reject BACKUP_NEWER
    --[the file is too large to be a project]--> reject BACKUP_TOO_LARGE
    --[default]--> [ProjectImported { projectId: id }]

  Person -> resetSample(projectId: id) in Project(projectId) @note("Person uses ProjectRow") @slice("Reset a sample") @story("As a Person, I want to reset a sample, so that sample reset is on record.")
    --[default]--> [SampleReset { projectId: id }]

  Person -> switchMode(projectId: id, mode: text) in Project(projectId) @note("Person uses ModeSwitch") @slice("Switch modeling mode") @note("DCB has one stream. Traditional spreads events across streams tied to aggregate roots.") @story("As a Person, I want to switch modeling mode, so that the mode is switched.")
    --[the project is already in that mode]--> reject MODE_SAME
    --[default]--> [ModeSwitched { projectId: id, mode: text }]

  Person -> setEventFormat(style: text, strictRoot: yesno) in Project(projectId) @note("Person uses ProjectSettingsDialog") @slice("Set the event format") @story("As a Person, I want to set the event format, so that event format set is on record.")
    --[renaming would give two elements the same name]--> reject NAME_COLLISION
    --[default]--> [EventFormatSet { projectId: id, style: text }]

  Person -> buildOnAnEventStore() @note("Person uses BuildOnAnEventStoreTrigger") @slice("Build on an event store") @note("Drafted from REQ-250. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [BuildOnAnEventStoreRecorded]

  Person -> seeOnlyWhatsBeenSharedWithYou() @note("Person uses SeeOnlyWhatsBeenSharedWithYouTrigger") @slice("See only what’s been shared with you") @note("Drafted from REQ-251. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [SeeOnlyWhatsBeenSharedWithYouRecorded]

  Person -> controlWhoSeesAProjectFeatureOrAnalytics() @note("Person uses ControlWhoSeesAProjectFeatureOrAnalyticsTrigger") @slice("Control who sees a project, feature or analytics") @note("Drafted from REQ-252. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [ControlWhoSeesAProjectFeatureOrAnalyticsRecorded]

  Person -> bringAModelInFromAnotherTool() @note("Person uses BringAModelInFromAnotherToolTrigger") @slice("Bring a model in from another tool") @note("Drafted from REQ-253. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [BringAModelInFromAnotherToolRecorded]

  Person -> keepAProjectsImagesInItsBackup() @note("Person uses KeepAProjectsImagesInItsBackupTrigger") @slice("Keep a project’s images in its backup") @note("Drafted from REQ-254. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [KeepAProjectsImagesInItsBackupRecorded]

  Person -> modelOnATablet() @note("Person uses ModelOnATabletTrigger") @slice("Model on a tablet") @note("Drafted from REQ-255. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [ModelOnATabletRecorded]

  Person -> exploreTheSampleWithoutAnAccount() @note("Person uses ExploreTheSampleWithoutAnAccountTrigger") @slice("Explore the sample without an account") @note("Drafted from REQ-256. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [ExploreTheSampleWithoutAnAccountRecorded]

  Person -> findTheProductPageAgain() @note("Person uses FindTheProductPageAgainTrigger") @slice("Find the product page again") @note("Drafted from REQ-257. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [FindTheProductPageAgainRecorded]

}

context Modeling {
  description: The score: lanes, elements, slices and the rules that keep them complete.
  publishes: SliceModeled, SliceDeleted

  view ScoreLayout(contextId: id, doneBy: text) = [SliceModeled, SliceMoved] => { lanes: list[text], slices: list[text] } @note("Person uses ScorePage") @slice("See the score") @story("As a Person, I want to see the score, so that I can see lanes and slices.")

  view OrderingErrors(id: id) = [SliceMoved] => { sliceId: id, needs: text, definedIn: text } @note("Person uses DependencyBanner") @slice("See what’s out of order") @note("Any slice can read what an earlier slice defines, usually its events and read models, so an automation or translation reading a read model from an earlier slice is complete without its own copy. A command can be reused like a component, but records the same events everywhere: reusing it brings them, changing them changes every use, and a slice where they differ is flagged. A read model only needs one of its events recorded by then, in that slice or an earlier one, and the others can start feeding it later. That lets a slice use a read model whose events it adds to. Events a slice starts from or lists as evidence must come first. Two slices with only each other to start from are flagged, until one's use of the read model is marked as allowed to be empty the first time, which is drawn differently and no longer decides the order.") @story("As a Person, I want to see what’s out of order, so that I can see slice id, needs and defined in.")

  view InformationGaps(id: id) = [SliceModeled, ElementEdited] => { sliceId: id, elementId: id } @note("Person uses SliceInspector") @slice("Check where information comes from") @note("Every field must come from what leads into it: an event from its command, a read model or query from its events, a command from its trigger and what that reads. An event’s own identity is exempt, and so are query parameters. Lines into an element with unsourced fields turn red. It’s a review aid, so it never makes a slice incomplete. Each gap can be fixed in one click: add the field to a source, carried on upstream until there’s a real choice, or take it off. Beside it, hints that are allowed but worth a second look: a command recording several events, changing several aggregates, or four or more events feeding one read model.") @story("As a Person, I want to check where information comes from, so that I can see slice id and element id.")

  view SashSection(id: id) = [SliceModeled] => { actor: text, handler: text, incoming: list[text], decider: text, commits: list[text] } @note("Person uses SashTable") @slice("Look at the model in Sash") @note("DCB cut into technical layers: Actor, Handler, Decider and Commit. The actor only starts the work, like a thin controller. The handler is the IO either side of a pure decider: it loads what's passed in (→), including what an automation or translator reads, and commits the events the decider returns (←), read like a function call. The project sets the default, and each person can switch for themselves. Decider only shows here.") @story("As a Person, I want to look at the model in Sash, so that I can see actor, handler, incoming, decider and commits.")

  view AssistAnswer(id: id) = [SuggestionAccepted] => { summary: text, findings: list[text], suggestions: list[text] } @note("Person uses AssistPanel") @slice("Ask the assistant") @note("On every page, aware of what’s on screen. Scripted answers unless a model is set up on the server, which keeps the key. Answers are checked against a strict shape and treated as untrusted.") @story("As a Person, I want to ask the assistant, so that I can see summary, findings and suggestions.")

  Person -> createSlice(name: text, pattern: text, position: number) in Slice(sliceId) @note("Person uses GuidedSliceDialog") @slice("Model a slice") @note("The only way to add elements: new elements arrive as complete slices. Connections only run event, read model or query, trigger, command, event. A translator only reads events from another domain or context.") @story("As a Person, I want to model a slice, so that the slice is modeled.")
    --[the slice is missing a step its pattern needs]--> reject SLICE_INCOMPLETE
    --[an element with that name is already defined]--> reject ELEMENT_DUPLICATE
    --[a connection skips a step, like an event going straight into a trigger]--> reject BAD_CONNECTION
    --[a translator reads a domain event from its own context]--> reject NOTHING_TO_TRANSLATE
    --[default]--> [SliceModeled { sliceId: id, name: text, pattern: text }]

  Person -> holdElement(label: text, kind: text) in Slice(sliceId) @note("Person uses BacklogTray") @slice("Keep an element in the backlog") @note("It can hold everything it would on the score, and keeps it all when Make a slice puts it there. A waiting read model can also list the events it will read, internal or external, and those lines are drawn when it joins a slice. Adding takes no form: type a name and press Enter, or paste a list, and the details can wait. It starts on events, because that’s how an event modeling session starts. A name the project already has isn’t added twice.") @story("As a Person, I want to keep an element in the backlog, so that element waiting is on record.")
    --[a field’s name or type isn’t valid]--> reject FIELD_INVALID
    --[default]--> [ElementWaiting { sliceId: id, label: text }]

  Person -> deleteWaitingElement(itemId: id) in Slice(sliceId) @note("Person uses BacklogTray") @slice("Delete a waiting element") @note("The only place an element can be deleted. Nothing in a slice can be: it’s swapped, or the whole slice goes, and what’s left unused waits here.") @story("As a Person, I want to delete a waiting element, so that the waiting element is deleted.")
    --[default]--> [WaitingElementDeleted { sliceId: id, itemId: id }]

  Person -> startDraftScore(name: text) in DraftScore(draftScoreId) @note("Person uses DraftScoresPage") @slice("Start a draft score") @note("Where a brainstorm happens, because the real score only takes complete slices. A project can have several. Nothing on it is part of the model, so it's never checked, and it isn't in problems, specs, model text or a review.") @story("As a Person, I want to start a draft score, so that the draft score is started.")
    --[default]--> [DraftScoreStarted { draftScoreId: id, name: text }]

  Person -> addDraftElements(draftScoreId: id, labels: list[text], kind: text) in DraftScore(draftScoreId) @note("Person uses DraftBoard") @slice("Add to a draft score") @note("A name and a type, one at a time or a pasted list. Repeated names are allowed and shown as a count, and event names aren't fixed until an element becomes real.") @story("As a Person, I want to add to a draft score, so that the draft elements are added.")
    --[the draft score is archived]--> reject DRAFT_ARCHIVED
    --[default]--> [DraftElementsAdded { draftScoreId: id, labels: list[text] }]

  Person -> moveDraftElement(elementId: id, x: number, y: number) in DraftScore(draftScoreId) @note("Person uses DraftBoard") @slice("Arrange a draft score") @note("Anywhere, by dragging or with Alt and the arrow keys.") @story("As a Person, I want to arrange a draft score, so that the draft element is moved.")
    --[the draft score is archived]--> reject DRAFT_ARCHIVED
    --[default]--> [DraftElementMoved { draftScoreId: id, elementId: id }]

  Person -> linkDraftElements(elementIds: list[id], sliceId: id) in DraftScore(draftScoreId) @note("Person uses DraftBoard") @slice("Make a slice from draft elements") @note("Through the usual New slice dialog, so the slice is complete and the names follow the project's rules. The elements stay on the draft score, faded and linked, to show what's left. Deleting the slice frees them.") @story("As a Person, I want to make a slice from draft elements, so that the draft elements are linked.")
    --[an element is already part of a slice]--> reject ALREADY_IN_SLICE
    --[default]--> [DraftElementsLinked { draftScoreId: id, sliceId: id }]

  Person -> moveDraftToBacklog(elementId: id) in DraftScore(draftScoreId) @note("Person uses DraftBoard") @slice("Move a draft element to the backlog") @note("For something clearly real with no slice yet. It takes on the project's naming here.") @story("As a Person, I want to move a draft element to the backlog, so that the draft element is moved to backlog.")
    --[the project already has that name]--> reject NAME_TAKEN
    --[the element is already part of a slice]--> reject ALREADY_IN_SLICE
    --[default]--> [DraftElementMovedToBacklog { draftScoreId: id, elementId: id }]

  Person -> archiveDraftScore(draftScoreId: id) in DraftScore(draftScoreId) @note("Person uses DraftBoard") @slice("Archive a draft score") @note("Kept as a record of the session, and read-only until it's restored.") @story("As a Person, I want to archive a draft score, so that the draft score is archived.")
    --[default]--> [DraftScoreArchived { draftScoreId: id }]

  Person -> moveLane(laneId: id, delta: number) in Slice(sliceId) @note("Person uses ScoreCanvas") @slice("Arrange swimlanes") @note("Actors sit above the one timeline, and event streams below it. Lanes move only within their section, and the timeline doesn’t move.") @story("As a Person, I want to arrange swimlanes, so that the lane is moved.")
    --[that would move a lane out of its section]--> reject LANE_SECTION
    --[a project has one timeline]--> reject ONE_TIMELINE
    --[default]--> [LaneMoved { sliceId: id, laneId: id }]

  Person -> addEventToCommand(sliceId: id) in Slice(sliceId) @note("Person uses CommandEvents") @slice("Give a command another event") @note("A command yields one or more events, and a read model can fold several. That's the one thing a complete slice can still gain.") @story("As a Person, I want to give a command another event, so that the command event is added.")
    --[the slice has no command]--> reject NO_COMMAND
    --[that event comes from another domain]--> reject EVENT_FROM_OUTSIDE
    --[default]--> [CommandEventAdded { sliceId: id, eventId: id }]

  Person -> moveSlice(sliceId: id, index: number) in Slice(sliceId) @note("Person uses ScoreCanvas") @slice("Move a slice") @story("As a Person, I want to move a slice, so that the slice is moved.")
    --[default]--> [SliceMoved { sliceId: id, index: number }]

  Person -> editElement(elementId: id) in Slice(sliceId) @note("Person uses ElementInspector") @slice("Edit an element") @note("A trigger has a type: UI, endpoint, command line or agent. Only a UI can have images, and the others have a standard icon. A UI's views can have their own images, shown by any use pointing at them. Automations and translators are triggers too, as kinds of their own.") @story("As a Person, I want to edit an element, so that the element is edited.")
    --[a field’s name or type isn’t valid]--> reject FIELD_INVALID
    --[default]--> [ElementEdited { sliceId: id, elementId: id }]

  Person -> convertSlice(sliceId: id, to: text, stateModel: text) in Slice(sliceId) @note("Person uses SliceInspector") @slice("Convert a slice’s storage") @note("Only changes what’s kept. Every command still yields at least one event in the model, because a state is the sum of events nobody kept.") @story("As a Person, I want to convert a slice’s storage, so that the slice is converted.")
    --[a state-backed slice needs a named state model]--> reject STATE_MODEL_MISSING
    --[default]--> [SliceConverted { sliceId: id, to: text }]

  Person -> publishEvent(contextId: id, eventId: id) in Slice(sliceId) @note("Person uses ContextsPage") @slice("Publish an event in a contract") @story("As a Person, I want to publish an event in a contract, so that the event is published.")
    --[default]--> [EventPublished { sliceId: id, contextId: id, eventId: id }]

  Person -> setRoute(placementId: id, method: text, route: text) in Slice(sliceId) @note("Person uses ElementInspector") @slice("Give a trigger a route") @note("On one use of a UI or endpoint trigger, since one page can call different routes in different slices. Sash shows it on the actor row, and two uses reaching different things on one route get flagged.") @story("As a Person, I want to give a trigger a route, so that route set is on record.")
    --[a route starts with a slash]--> reject ROUTE_INVALID
    --[only a UI or endpoint trigger has a route]--> reject NOT_REACHABLE
    --[default]--> [RouteSet { sliceId: id, method: text, route: text }]

  Person -> setContextRole(contextId: id, role: text, implements: list[text], infrastructure: text) in Project(projectId) @note("Person uses ContextsPage") @slice("Mark a context as core or adapter") @note("A core holds business rules and owns its ports. An adapter implements ports for one piece of infrastructure, and is modeled like any other context, with its own slices and requirements. Most ports follow from the slices; anything else is declared on the core.") @planned @story("As a Person, I want to mark a context as core or adapter, so that context role set is on record.")
    --[an adapter implements a port nothing declares]--> reject PORT_UNKNOWN
    --[a core would depend on an adapter]--> reject CORE_DEPENDS_OUT
    --[default]--> [ContextRoleSet { projectId: id, contextId: id, role: text }]

  Person -> setRejectionRule(elementId: id, code: text, shape: text, event: text) in Slice(sliceId) @note("Person uses ElementInspector") @slice("Write a rejection as a rule") @note("Optional, beside the plain words: exists, absent, count at least, or a field compared with the evidence. A rule lets that branch of the decider be generated without AI.") @planned @story("As a Person, I want to write a rejection as a rule, so that rejection rule set is on record.")
    --[the rule names an event the decision doesn’t read]--> reject RULE_EVENT_MISSING
    --[default]--> [RejectionRuleSet { sliceId: id, code: text }]

  Person -> applyModelText(text: text) in Slice(sliceId) @note("Person uses ModelTextEditor") @slice("Apply the model text") @note("It may leave a slice with no requirement, which shows up in Traceability.") @story("As a Person, I want to apply the model text, so that the model text is applied.")
    --[a line can’t be understood]--> reject TEXT_INVALID
    --[the text would leave a new slice incomplete]--> reject UNIT_INCOMPLETE
    --[default]--> [ModelTextApplied { sliceId: id }]

  Person -> generateDeciders(commandIds: list[id]) in Slice(sliceId) @note("Person uses SashTable") @slice("Generate a decider") @note("Required in Sash except for state views. Named after its command, because it’s the part of a command that works out new state and events without IO.") @story("As a Person, I want to generate a decider, so that the decider is generated.")
    --[default]--> [DeciderGenerated { sliceId: id }]

  Person -> deleteSlice(sliceId: id) in Slice(sliceId) @note("Person uses SliceDeleteDialog") @slice("Delete a slice") @note("A story that exists only for this slice goes with it. Elements nothing else uses move to the backlog.") @story("As a Person, I want to delete a slice, so that the slice is deleted.")
    --[default]--> [SliceDeleted { sliceId: id }]

  Person -> swapElement(placementId: id, elementId: id) in Slice(sliceId) @note("Person uses SwapElementDialog") @slice("Swap an element") @note("How a complete slice changes shape, since it can’t lose a step it needs. The replacement can be reused, taken from the backlog or defined new. It’s also how one use of a reused element is unlinked: that slice gets a copy under a new name, and the others stay linked to the original.") @story("As a Person, I want to swap an element, so that the element is swapped.")
    --[the replacement is a different kind of element]--> reject SWAP_KIND
    --[that element is already in this slice]--> reject ELEMENT_REPEATED
    --[default]--> [ElementSwapped { sliceId: id, elementId: id }]

  Person -> fillSliceStep(sliceId: id, elementId: id) in Slice(sliceId) @note("Person uses SliceInspector") @slice("Add a slice’s missing step") @note("Imports and older projects can leave a slice incomplete. Each missing step can be added from the backlog, reused or defined new, and it's joined up to the rest of the slice. What's waiting in the backlog is also offered in an element's references when the slice lacks that step. Add to slice is one action for all of this: from a backlog card, an element on the score or one draft card, it lists every slice by what would happen, says what will change, and fills a gap, replaces what's there or makes a new slice. A slice that can't take it says why.") @story("As a Person, I want to add a slice’s missing step, so that the slice step is filled.")
    --[the slice already has that step]--> reject STEP_NOT_MISSING
    --[default]--> [SliceStepFilled { sliceId: id, elementId: id }]

  Person -> defineFromReference(placementId: id, kind: text, name: text) in Slice(sliceId) @note("Person uses ElementInspector") @slice("Define an element from its references") @note("New, under References, defines what leads into an element and connects it in one go, without leaving the panel. It joins that slice, so it's only offered where the slice can take it. A new query for a trigger in a state change goes in a new state view just before, where the same trigger shows it, or on its own if it's marked as a projection. A projection is a query nobody looks at, so its state view needs no trigger.") @story("As a Person, I want to define an element from its references, so that the element is defined from reference.")
    --[default]--> [ElementDefinedFromReference { sliceId: id, elementId: id }]

  Person -> takeOutEvent(placementId: id) in Slice(sliceId) @note("Person uses ElementInspector") @slice("Take an event out of a slice") @note("Only an event, and never a command’s last one. Nothing else can be deleted from a slice: it’s swapped, or the whole slice goes.") @story("As a Person, I want to take an event out of a slice, so that event taken out is on record.")
    --[the slice would lose a step its pattern needs]--> reject SLICE_WOULD_BREAK
    --[only an event can be taken out of a slice]--> reject NOT_REMOVABLE
    --[default]--> [EventTakenOut { sliceId: id, elementId: id }]

  RequirementToSlice -> draftSlice(requirementId: id) in Slice(sliceId) @slice("Draft a slice from a requirement") @note("Stories and slices exist together. Its element names are placeholders until someone confirms it. Only imports and pasted text can leave either side alone.") @story("As the business, I want to draft a slice from a requirement when requirement written is on record, so that the slice is drafted.") @note("translates from Requirements contract v1")
    --[default]--> [SliceDrafted { sliceId: id, requirementId: id }]

  Person -> confirmSlice(sliceId: id) in Slice(sliceId) @note("Person uses SliceInspector") @slice("Confirm a drafted slice") @note("Until then, its requirement doesn’t count as covered.") @story("As a Person, I want to confirm a drafted slice, so that the slice is confirmed.")
    --[default]--> [SliceConfirmed { sliceId: id }]

  Person -> acceptSuggestion(suggestion: text) in Slice(sliceId) @note("Person uses AssistPanel") @slice("Accept an assistant’s suggestion") @note("Suggestions become the same commands a person’s edits use, so every rule applies. The person is credited, and it’s marked as made with AI. A project can let a single suggestion apply itself.") @story("As a Person, I want to accept an assistant’s suggestion, so that the suggestion is accepted.")
    --[the project’s rules wouldn’t accept it]--> reject RULE_BROKEN
    --[default]--> [SuggestionAccepted { sliceId: id }]

  Person -> putContextsInsideDomains() @note("Person uses PutContextsInsideDomainsTrigger") @slice("Put contexts inside domains") @note("Drafted from REQ-350. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [PutContextsInsideDomainsRecorded]

  Person -> offerAnEventThatAlreadyExists() @note("Person uses OfferAnEventThatAlreadyExistsTrigger") @slice("Offer an event that already exists") @note("Drafted from REQ-351. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [OfferAnEventThatAlreadyExistsRecorded]

  Person -> swapALocalStandInForTheRealEvent() @note("Person uses SwapALocalStandInForTheRealEventTrigger") @slice("Swap a local stand-in for the real event") @note("Drafted from REQ-352. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [SwapALocalStandInForTheRealEventRecorded]

}

context Sequencing {
  description: Flows, and playing them back in Story Replay.

  view FlowPerformance(id: id) = [FlowCreated, FlowArranged, FlowReordered] => { beats: list[text] } @note("Person uses ReplayPage") @slice("Play a flow") @note("Story Replay, the signature: the model, a narrative and the Gherkin move together. It calls out each move into another context. A flow that plays something before it’s defined won’t play. With many lanes it zooms in (+, −, 0 to fit) and follows the beat up and down. From the score, it plays the selected slice within its flow or a chosen flow, and leaving goes back to the slice that was playing.") @story("As a Person, I want to play a flow, so that I can see beats.")

  Person -> createFlow(name: text) in Flow(flowId) @note("Person uses NewFlowDialog") @slice("Create a flow") @story("As a Person, I want to create a flow, so that the flow is created.")
    --[default]--> [FlowCreated { flowId: id, name: text }]

  Person -> arrangeFlow(flowId: id, sliceId: id) in Flow(flowId) @note("Person uses FlowLayoutBoard") @slice("Arrange a flow") @story("As a Person, I want to arrange a flow, so that the flow is arranged.")
    --[default]--> [FlowArranged { flowId: id, sliceId: id }]

  Person -> setFlowOrder(flowId: id, sliceIds: list[id]) in Flow(flowId) @note("Person uses FlowOrderIssues") @slice("Put a flow in a working order") @story("As a Person, I want to put a flow in a working order, so that the flow is reordered.")
    --[default]--> [FlowReordered { flowId: id }]

  SliceDeletedToFlows -> dropSliceFromFlows(sliceId: id) in Flow(flowId) @slice("Keep flows current when a slice goes") @story("As the business, I want to keep flows current when a slice goes when the slice is deleted, so that slice left flows is on record.") @note("translates from Modeling contract v1")
    --[default]--> [SliceLeftFlows { flowId: id, sliceId: id }]

  Person -> groupIntoFeature(name: text) in Flow(flowId) @note("Person uses FeaturesPage") @slice("Group flows into a feature") @note("Decided: slices combine into flows, and flows into features. How they trace to requirements is still open.") @planned @story("As a Person, I want to group flows into a feature, so that the feature is defined.")
    --[default]--> [FeatureDefined { flowId: id, name: text }]

  Person -> traceAFeatureToItsRequirements() @note("Person uses TraceAFeatureToItsRequirementsTrigger") @slice("Trace a feature to its requirements") @note("Drafted from REQ-450. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [TraceAFeatureToItsRequirementsRecorded]

}

context Requirements {
  description: Writing requirements, and generating them from slices.
  publishes: RequirementLinked, RequirementWritten

  view RequirementTreeView(contextId: id, doneBy: text) = [RequirementWritten, RequirementGenerated, RequirementLinked] => { ref: text, title: text, status: text } @note("Person uses RequirementsPage") @slice("Browse requirements") @story("As a Person, I want to browse requirements, so that I can see ref, title and status.")

  Person -> writeRequirement(title: text, type: text) in Requirement(requirementId) @note("Person uses RequirementEditor") @slice("Write a requirement") @note("Plain text, a user story or Gherkin. Switching re-expresses it in the other form.") @story("As a Person, I want to write a requirement, so that requirement written is on record.")
    --[the requirement has no title]--> reject TITLE_MISSING
    --[default]--> [RequirementWritten { requirementId: id, title: text }]

  SliceToRequirement -> generateRequirement(sliceId: id) in Requirement(requirementId) @slice("Generate a requirement from a slice") @note("Happens by itself when a slice is made, as a draft. Hand edits are kept apart from generated text.") @story("As the business, I want to generate a requirement from a slice when the slice is modeled, so that the requirement is generated.") @note("translates from Modeling contract v1")
    --[default]--> [RequirementGenerated { requirementId: id, sliceId: id }]

  Person -> deleteRequirement(requirementId: id) in Requirement(requirementId) @note("Person uses RequirementDeleteDialog") @slice("Delete a requirement") @note("A slice that exists only for this story goes with it.") @story("As a Person, I want to delete a requirement, so that the requirement is deleted.")
    --[default]--> [RequirementDeleted { requirementId: id }]

  Person -> linkRequirement(requirementId: id, sliceId: id, kind: text) in Requirement(requirementId) @note("Person uses RequirementCard") @slice("Link a requirement to a slice") @story("As a Person, I want to link a requirement to a slice, so that the requirement is linked.")
    --[unlinking would leave a story or a slice with nothing on the other side]--> reject LAST_LINK
    --[default]--> [RequirementLinked { requirementId: id, sliceId: id }]

  SliceDeletedToRequirements -> unlinkDeletedSlice(sliceId: id) in Requirement(requirementId) @slice("Unlink requirements when a slice goes") @story("As the business, I want to unlink requirements when a slice goes when the slice is deleted, so that the requirement is unlinked.") @note("translates from Modeling contract v1")
    --[default]--> [RequirementUnlinked { requirementId: id, sliceId: id }]

  Person -> withdrawRequirement(requirementId: id) in Requirement(requirementId) @note("Person uses RequirementCard") @slice("Withdraw a requirement") @note("How a shipped story and its slice are removed: both stay, marked as being removed, until the removal is delivered and ships, then they leave the next version. One that never shipped is deleted as today. For release versions, every RequirementWritten will also carry a revision number. The story and its slice are paired when one drafts the other, so the pairing comes from SliceDrafted or RequirementGenerated, and each slice implements exactly one story. Rewording a story's Gherkin or a scenario under it is a new revision of that story, so a scenario must sit under a story. Epics, features and constraints have no slice, so they're shown around a version rather than in it.") @planned @story("As a Person, I want to withdraw a requirement, so that requirement withdrawn is on record.")
    --[a requirement that never shipped is just deleted]--> reject NOT_SHIPPED
    --[default]--> [RequirementWithdrawn { requirementId: id, sliceId: id }]

}

context Traceability {
  description: How well the requirements and the model cover each other.

  view CoverageMatrix(id: id) = [CoverageRecorded] => { requirements: list[text], slices: list[text], share: number } @note("Person uses TraceabilityPage") @slice("See the coverage matrix") @note("This measures coverage between requirements and the model. It says nothing about code or tests. Every issue is counted in one strip at the top, the matrix marks gaps and jumps between them, and every row and column opens its requirement or slice.") @story("As a Person, I want to see the coverage matrix, so that I can see requirements, slices and share.")

  view RejectionCoverage(id: id) = [CoverageRecorded] => { code: text, slice: text, covered: yesno } @note("Person uses RejectionsSection") @slice("See rejections with no scenario") @story("As a Person, I want to see rejections with no scenario, so that I can see code, slice and covered.")

  view OutOfDateSlices(id: id) = [RequirementWritten, SliceDelivered] => { slice: text, delivered: number, current: number } @note("Person uses TraceabilityPage") @slice("See slices behind their requirement") @note("A requirement reworded after its slice was delivered. The slice is flagged until it's delivered against the new revision.") @planned @story("As a Person, I want to see slices behind their requirement, so that I can see slice, delivered and current.")

  view ProjectProblems(id: id) = [CoverageRecorded] => { slice: text, kind: text, detail: text } @note("Person uses ProblemsMenu") @slice("See every problem in one place") @note("One icon with a count in the project header, on every page. It lists what’s out of order, crossing a boundary, missing, unsourced, naming unknown evidence, sharing a route, misnamed or without a requirement, and each goes to its slice. A slice’s header holds one stamp with its count. Drafts and reviews are states, not problems. The samples are valid, and a practice project with these problems put in on purpose is only loaded when someone asks for it.") @story("As a Person, I want to see every problem in one place, so that I can see slice, kind and detail.")

  LinksToCoverage -> recordCoverage(requirementId: id, sliceId: id) in Coverage(projectId) @slice("Track coverage from requirements") @story("As the business, I want to track coverage from requirements when the requirement is linked, so that the coverage is recorded.") @note("translates from Requirements contract v1")
    --[default]--> [CoverageRecorded { projectId: id }]

  Person -> seeWhatAChangeToARequirementAffects() @note("Person uses SeeWhatAChangeToARequirementAffectsTrigger") @slice("See what a change to a requirement affects") @note("Drafted from REQ-650. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [SeeWhatAChangeToARequirementAffectsRecorded]

}

context Delivery {
  description: The plan, the board, analytics and exports.

  view PlanRollup(id: id) = [PlanItemAdded, SlicePlanned] => { total: number, done: number, overrun: yesno } @note("Person uses PlanTree") @slice("See the plan") @story("As a Person, I want to see the plan, so that I can see total, done and overrun.")

  view ReadyToShip(id: id) = [SliceDelivered, RequirementWithdrawn, ReleaseShipped] => { requirement: text, change: text, revision: number } @note("Person uses ShipReleaseDialog") @slice("See what’s ready to ship") @planned @story("As a Person, I want to see what’s ready to ship, so that I can see requirement, change and revision.")

  view RequirementsVersion(id: id) = [ReleaseShipped] => { version: text, requirements: list[text] } @note("Person uses VersionsPage") @slice("See a requirements version") @note("Every shipped release up to this one, folded in order: everything still valid when it went out. It can be downloaded, and compared with another version.") @planned @story("As a Person, I want to see a requirements version, so that I can see version and requirements.")

  view BoardColumns(id: id) = [SlicePlanned] => { status: text, cards: list[text] } @note("Person uses BoardPage") @slice("See the board") @note("Behind a mock port.") @story("As a Person, I want to see the board, so that I can see status and cards.")

  view AnalyticsSnapshot(id: id) = [PlanItemAdded] => { slices: number, requirementShare: number } @note("Person uses AnalyticsPage") @slice("See analytics") @note("Behind a mock port, with made-up history.") @story("As a Person, I want to see analytics, so that I can see slices and requirement share.")

  view DiagramView(id: id) = [DiagramSaved] => { slices: list[text], requirements: list[text] } @note("Person uses PresentPage") @slice("Present a diagram") @note("Full screen and read-only, stepping slice by slice with its requirements and Gherkin alongside. A flow that's out of order won't present. Zoom (+, −, 0 to fit) brings many lanes up to size; the lanes then follow the slice in view, and can be scrolled or dragged, with slice and lane names held at the edges.") @story("As a Person, I want to present a diagram, so that I can see slices and requirements.")

  Person -> setPlanLevels(levels: list[text]) in Plan(planItemId) @note("Person uses PlanLevelsDialog") @slice("Name the plan’s levels") @note("Each project names its own, like Release, Milestone, Sprint or Marathon, Run, Sprint.") @state(model="PlanLevels", result="the plan’s levels are renamed") @story("As a Person, I want to name the plan’s levels, so that the plan’s levels are renamed.")
    --[the plan already goes deeper than the new levels]--> reject LEVELS_IN_USE
    --[default]--> [PlanLevelsRenamed { planItemId: id, levels: list[text] }]

  Person -> addPlanItem(name: text, parentId: id) in Plan(planItemId) @note("Person uses PlanItemDialog") @slice("Add to the plan") @story("As a Person, I want to add to the plan, so that the plan item is added.")
    --[default]--> [PlanItemAdded { planItemId: id, name: text }]

  Person -> assignToPlan(sliceId: id, planItemId: id) in Plan(planItemId) @note("Person uses PlanPage") @slice("Put a slice in the plan") @note("A slice has one place at a time, plus a history of where it rolled over from.") @story("As a Person, I want to put a slice in the plan, so that the slice is planned.")
    --[the slice is waiting on a review that hasn’t closed]--> reject REVIEW_PENDING
    --[default]--> [SlicePlanned { planItemId: id, sliceId: id }]

  Person -> deliverSlice(sliceId: id) in Slice(sliceId) @note("Person uses PlanTree") @slice("Deliver a slice") @note("Done, against the requirement's current revision. For a withdrawn requirement, it means the removal is done. Planning stays a forecast: only delivering and shipping need to be traceable.") @planned @story("As a Person, I want to deliver a slice, so that the slice is delivered.")
    --[the slice doesn’t implement a requirement]--> reject NO_REQUIREMENT
    --[default]--> [SliceDelivered { sliceId: id, requirementId: id, revision: number }]

  Person -> shipRelease(planItemId: id, version: text) in Plan(planItemId) @note("Person uses ShipReleaseDialog") @slice("Ship a release") @note("Only a top-level plan item ships. It takes everything delivered since the last ship, like tagging a branch, so the plan only predicts it. It records those revisions and removals, so a version can be read without replaying history. Whether each is added, changed or removed is worked out, never chosen. SliceRM suggests a semver number to confirm.") @planned @story("As a Person, I want to ship a release, so that the release is shipped.")
    --[the version isn’t higher than the last one shipped]--> reject VERSION_NOT_NEWER
    --[nothing has been delivered since the last release]--> reject NOTHING_TO_SHIP
    --[default]--> [ReleaseShipped { planItemId: id, version: text, contents: list[text] }]

  Person -> saveDiagram(name: text, scope: text, audience: text) in Plan(planItemId) @note("Person uses DiagramsPage") @slice("Save a diagram") @note("A saved view of part of the model, with branding. It holds no copy, so it stays current. Drawn as Score or Sash, chosen when it's made; Sash needs a DCB project. Client diagrams hide gaps, drafts, agents, notes and assignees.") @story("As a Person, I want to save a diagram, so that the diagram is saved.")
    --[the diagram has no name]--> reject DIAGRAM_NAME_MISSING
    --[default]--> [DiagramSaved { planItemId: id, name: text }]

  Person -> downloadDiagram(format: text) in Plan(planItemId) @note("Person uses DiagramsPage") @slice("Download a diagram") @note("PNG is the overview. PDF is the overview, then a page close up on each slice. Files use the light colours and common fonts.") @story("As a Person, I want to download a diagram, so that the diagram is downloaded.")
    --[default]--> [DiagramDownloaded { planItemId: id, format: text }]

  Person -> exportProject(format: text) in Plan(planItemId) @note("Person uses ExportPage") @slice("Export a project") @story("As a Person, I want to export a project, so that the project is exported.")
    --[default]--> [ProjectExported { planItemId: id, format: text }]

  Person -> linkTrackerIssue(sliceId: id, tracker: text, issueKey: text) in Plan(planItemId) @note("Person uses SliceInspector") @slice("Link a slice to a tracker issue") @note("Jira or Linear, behind a delivery port. One slice is one issue, so its status can come back to the plan and the board instead of being kept twice.") @planned @story("As a Person, I want to link a slice to a tracker issue, so that the tracker issue is linked.")
    --[default]--> [TrackerIssueLinked { planItemId: id, sliceId: id, issueKey: text }]

  Person -> linkBranch(sliceId: id, repository: text, branch: text) in Plan(planItemId) @note("Person uses SliceInspector") @slice("Link a slice to a branch") @note("Git, behind a delivery port. A spec can travel with the branch, and a merged pull request could mark the slice done. Traceability would then reach code, which it doesn’t today.") @planned @story("As a Person, I want to link a slice to a branch, so that the branch is linked.")
    --[default]--> [BranchLinked { planItemId: id, sliceId: id, branch: text }]

  Person -> fileBugsAndEnhancements() @note("Person uses FileBugsAndEnhancementsTrigger") @slice("File bugs and enhancements") @note("Drafted from REQ-750. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [FileBugsAndEnhancementsRecorded]

  Person -> showWorkStatusOnTheBoard() @note("Person uses ShowWorkStatusOnTheBoardTrigger") @slice("Show work status on the board") @note("Drafted from REQ-751. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [ShowWorkStatusOnTheBoardRecorded]

}

context Collaboration {
  description: Working alongside teammates, without a live session.


  Person -> hostDraftSession(draftScoreId: id) in DraftScore(draftScoreId) @note("Person uses SessionPanel") @slice("Host a session on a draft score") @note("Behind a mock port that keeps sessions in this browser, so its link only works in other tabs for now. A session holds only the draft score's names, not the project. What people add waits, counted, until the host brings it onto the board, so the board never shifts under them. The host's additions go out to everyone. Scripted guests can play a messy brainstorm through the same port, so one person can try a busy session.") @story("As a Person, I want to host a session on a draft score, so that the draft session is started.")
    --[default]--> [DraftSessionStarted { draftScoreId: id }]

  Person -> endDraftSession(draftScoreId: id) in DraftScore(draftScoreId) @note("Person uses SessionPanel") @slice("End a session") @note("Only the host can. One left open closes itself after 24 hours. Its copy is deleted 7 days after it ends, or sooner if the host chooses, once nothing is waiting. What was brought onto the board stays.") @story("As a Person, I want to end a session, so that the draft session is ended.")
    --[only the host can end a session]--> reject NOT_HOST
    --[default]--> [DraftSessionEnded { draftScoreId: id }]

  Reviewer -> addToDraftSession(name: text, labels: list[text]) in DraftScore(draftScoreId) @note("Reviewer uses JoinSessionPage") @slice("Add to a session") @note("Just a link and a name, with no account, and it works on a phone. Anyone with the link can join under any name, so the host can remove items and end the session. They see the draft score's name and what's been added, and nothing else from the project. Everything sent is untrusted, so names and how much can be added are limited.") @story("As a Reviewer, I want to add to a session, so that the draft session entries are added.")
    --[the session has ended]--> reject SESSION_ENDED
    --[one person is adding too much too quickly]--> reject TOO_FAST
    --[a name is too long]--> reject NAME_TOO_LONG
    --[default]--> [DraftSessionEntriesAdded { draftScoreId: id, name: text, labels: list[text] }]

  System -> countIncoming(projectId: id) in Review(projectId) @slice("Check for teammates’ changes") @note("Really runs every 30 seconds, and whenever you come back to the window. Schedules only go down to minutes. A toast says when more changes arrive, and nothing loads until you reload.") @story("As the business, I want the system to check for teammates’ changes without anyone asking, so that the incoming is counted.")
    --[default]--> [IncomingCounted { projectId: id, count: number }]

  Person -> applyReload(projectId: id) in Review(projectId) @note("Person uses ReloadDialog") @slice("Reload teammates’ changes") @note("Teammates are scripted. Settings and every item merge field by field, so only a field both sides changed differently, or something one side deleted while the other changed it, needs a choice. Anything left pointing at something deleted is listed before it goes.") @story("As a Person, I want to reload teammates’ changes, so that the changes are merged.")
    --[default]--> [ChangesMerged { projectId: id, revision: number }]

  Person -> sendReview(name: text, scope: text, audience: text) in Review(projectId) @note("Person uses SendReviewDialog") @slice("Send a review") @note("Freezes the scope, so everyone reviews one version. The author chooses required reviewers. Its slices can’t be scheduled until it closes.") @story("As a Person, I want to send a review, so that the review is sent and scope frozen is on record.")
    --[nobody has been asked]--> reject NO_REVIEWERS
    --[there’s nothing in this scope to review]--> reject NOTHING_IN_SCOPE
    --[default]--> [ReviewSent { projectId: id, name: text }, ScopeFrozen { projectId: id, scope: text }]

  Reviewer -> leaveNote(anchor: text, kind: text, text: text, blocking: yesno) in Review(projectId) @note("Reviewer uses ReviewPage") @slice("Annotate a review") @note("Through a private link, with no account needed. Notes pin to slices, elements and requirements, and can flag missing requirements or suggest new ones, especially non-functional ones.") @story("As a Reviewer, I want to annotate a review, so that note left is on record.")
    --[the link has expired or been turned off]--> reject LINK_DEAD
    --[only a required reviewer can block]--> reject NOT_REQUIRED
    --[default]--> [NoteLeft { projectId: id, anchor: text }]

  Reviewer -> giveVerdict(verdict: text) in Review(projectId) @note("Reviewer uses ReviewPage") @slice("Give a review verdict") @story("As a Reviewer, I want to give a review verdict, so that verdict given is on record.")
    --[default]--> [VerdictGiven { projectId: id, verdict: text }]

  Person -> answerNote(noteId: id, status: text, reply: text) in Review(projectId) @note("Person uses ReviewsPage") @slice("Answer a review note") @note("Only the author can apply a suggestion to the model. Declining needs a reason the reviewer can see.") @story("As a Person, I want to answer a review note, so that the note is answered.")
    --[declining needs a reason]--> reject REASON_MISSING
    --[default]--> [NoteAnswered { projectId: id, noteId: id, status: text }]

  Person -> closeReview(outcome: text) in Review(projectId) @note("Person uses ReviewsPage") @slice("Close a review") @story("As a Person, I want to close a review, so that the review is closed and the review hold is released.")
    --[a blocking note is open, or a required reviewer hasn’t approved]--> reject REVIEW_BLOCKED
    --[default]--> [ReviewClosed { projectId: id, outcome: text }, ReviewHoldReleased { projectId: id }]

  Person -> designateBlockersAndReviewersPerProject() @note("Person uses DesignateBlockersAndReviewersPerProjectTrigger") @slice("Designate blockers and reviewers per project") @note("Drafted from REQ-850. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [DesignateBlockersAndReviewersPerProjectRecorded]

  Person -> inviteAnOngoingReviewerAsAGuestOnAProject() @note("Person uses InviteAnOngoingReviewerAsAGuestOnAProjectTrigger") @slice("Invite an ongoing reviewer as a guest on a project") @note("Drafted from REQ-851. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [InviteAnOngoingReviewerAsAGuestOnAProjectRecorded]

  Person -> recoverWhenASaveIsRefusedAsOutOfDate() @note("Person uses RecoverWhenASaveIsRefusedAsOutOfDateTrigger") @slice("Recover when a save is refused as out of date") @note("Drafted from REQ-852. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [RecoverWhenASaveIsRefusedAsOutOfDateRecorded]

  Person -> joinASessionFromAnotherDevice() @note("Person uses JoinASessionFromAnotherDeviceTrigger") @slice("Join a session from another device") @note("Drafted from REQ-853. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [JoinASessionFromAnotherDeviceRecorded]

  Person -> bringATeammateUpToSpeedOnAProject() @note("Person uses BringATeammateUpToSpeedOnAProjectTrigger") @slice("Bring a teammate up to speed on a project") @note("Drafted from REQ-854. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [BringATeammateUpToSpeedOnAProjectRecorded]

  every 1 minutes
  from [IncomingChanges]
    -> ChangeChecker -> countIncoming()

}

context Specs {
  description: Moving slices in and out as readable text.


  Person -> exportSpec(scope: text) in Spec(specId) @note("Person uses SpecsExportPanel") @slice("Export a spec") @story("As a Person, I want to export a spec, so that the spec is exported.")
    --[default]--> [SpecExported { specId: id, scope: text }]

  Person -> importSpec(text: text) in Spec(specId) @note("Person uses SpecsImportPanel") @slice("Import a spec") @note("Three-way: only a field changed on both sides since export needs a choice. A spec doesn’t carry a rejection’s rule, so the rule stays with the rejection of the same code.") @story("As a Person, I want to import a spec, so that the spec is imported.")
    --[a line in the spec can’t be understood]--> reject SPEC_INVALID
    --[the spec would leave a slice incomplete]--> reject SPEC_INCOMPLETE
    --[default]--> [SpecImported { specId: id }]

}

context Agents {
  description: Letting AI agents take part, and keeping them accountable.

  view SessionBriefing(id: id) = [SessionStarted] => { persona: text, openWork: list[text], notes: list[text] } @note("Sponsor uses SessionPage") @slice("See the briefing") @story("As a Sponsor, I want to see the briefing, so that I can see persona, open work and notes.")

  view AgentOversight(id: id) = [SessionStarted, WorkClaimed, WorkSubmitted] => { active: number, leases: number, waiting: number } @note("Sponsor uses OverviewTab") @slice("Oversee agents") @story("As a Sponsor, I want to oversee agents, so that I can see active, leases and waiting.")

  Sponsor -> definePersona(name: text, purpose: text) in Persona(personaId) @note("Sponsor uses PersonaDialog") @slice("Define a persona") @story("As a Sponsor, I want to define a persona, so that the persona is defined.")
    --[there is already a persona with this name]--> reject PERSONA_TAKEN
    --[default]--> [PersonaDefined { personaId: id, name: text }]

  Sponsor -> issuePass(personaId: id, maxSessions: number) in Pass(passId) @note("Sponsor uses IssuePassDialog") @slice("Issue a pass") @story("As a Sponsor, I want to issue a pass, so that the pass are issued.")
    --[the expiry isn’t in the future]--> reject PASS_EXPIRY_PAST
    --[default]--> [PassIssued { passId: id, personaId: id }]

  Sponsor -> revokePass(passId: id) in Pass(passId) @note("Sponsor uses PassesTab") @slice("Revoke a pass") @note("At once. Its changes stay, flagged as coming from a revoked session.") @story("As a Sponsor, I want to revoke a pass, so that the pass are revoked and the sessions are ended.")
    --[default]--> [PassRevoked { passId: id }, SessionsEnded { passId: id }]

  Agent -> arriveWithPass(passId: id, tool: text, model: text) in Session(sessionId) @note("Agent uses AgentArrival") @slice("Arrive as an agent") @note("Each session gets a new handle that’s never reused, and a briefing because it remembers nothing.") @story("As an Agent, I want to arrive as an agent, so that the session is started.")
    --[the pass is expired, used up or revoked]--> reject PASS_CLOSED
    --[default]--> [SessionStarted { sessionId: id, handle: text, passId: id }]

  Agent -> claimWork(workId: text) in Claim(workId) @note("Agent uses AgentClaim") @slice("Claim work") @story("As an Agent, I want to claim work, so that the work is claimed.")
    --[another session already holds this]--> reject CLAIM_TAKEN
    --[work on this is waiting for review]--> reject CLAIM_IN_REVIEW
    --[default]--> [WorkClaimed { workId: text, sessionId: id }]

  System -> releaseLease(workId: text) in Claim(workId) @slice("Release lapsed leases") @note("Really checks every second. The item shows as abandoned work for the next arrival.") @story("As the business, I want the system to release lapsed leases without anyone asking, so that the lease is released.")
    --[default]--> [LeaseReleased { workId: text }]

  Agent -> submitWork(workId: text, summary: text) in Proposal(proposalId) @note("Agent uses AgentSubmit") @slice("Submit work") @note("Lands as a proposal unless the persona applies directly. Destructive and bulk changes always need approval.") @story("As an Agent, I want to submit work, so that the work is submitted.")
    --[the lease has ended, so this can’t be submitted]--> reject LEASE_ENDED
    --[default]--> [WorkSubmitted { proposalId: id, workId: text }]

  Reviewer -> reviewWork(proposalId: id, outcome: text, comment: text) in Proposal(proposalId) @note("Reviewer uses ReviewTab") @slice("Review agent work") @note("Only a person can do this. No persona can approve its own work.") @story("As a Reviewer, I want to review agent work, so that the work is reviewed.")
    --[sending back or rejecting needs a comment]--> reject COMMENT_MISSING
    --[default]--> [WorkReviewed { proposalId: id, outcome: text }]

  Agent -> writeHandoffNote(text: text) in Session(sessionId) @note("Agent uses AgentNote") @slice("Leave a handoff note") @note("Every later session reads it in its briefing.") @story("As an Agent, I want to leave a handoff note, so that handoff note left is on record.")
    --[default]--> [HandoffNoteLeft { sessionId: id, text: text }]

  Person -> handAnAssistantsTaskToAnAgent() @note("Person uses HandAnAssistantsTaskToAnAgentTrigger") @slice("Hand an assistant’s task to an agent") @note("Drafted from REQ-1050. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [HandAnAssistantsTaskToAnAgentRecorded]

  Person -> letRealAgentsConnect() @note("Person uses LetRealAgentsConnectTrigger") @slice("Let real agents connect") @note("Drafted from REQ-1051. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [LetRealAgentsConnectRecorded]

  every 1 minutes
  from [LapsedLeases]
    -> LeaseSweeper -> releaseLease()

}

context Generation {
  description: Turning the model into tested code, through builders anyone can add.

  view CodePlan(id: id) = [SliceModeled, CodeProfileSet] => { contexts: list[text], ports: list[text], files: list[text] } @note("Person uses GeneratePanel") @slice("Preview the code plan") @note("Language-neutral: each context’s role and ports, each slice’s evidence, guard, rejections and scenarios, and what fills each port. Refused, with reasons, while a slice in scope is incomplete or out of order.") @planned @story("As a Person, I want to preview the code plan, so that I can see contexts, ports and files.")

  Person -> setCodeProfile(builderId: text, targets: list[text], layout: text) in Project(projectId) @note("Person uses CodeProfileDialog") @slice("Choose how code is built") @note("TypeScript first (core, Node, React), then C#. The layout maps contexts, features and adapters onto any folder structure, so existing codebases fit.") @planned @state(model="CodeProfile", result="the project builds code this way") @story("As a Person, I want to choose how code is built, so that the project builds code this way.")
    --[no builder with that name is available]--> reject BUILDER_MISSING
    --[the builder can’t produce that target]--> reject TARGET_UNSUPPORTED
    --[default]--> [CodeProfileSet { projectId: id, builderId: text }]

  Person -> generateCode(scope: text) in Build(buildId) @note("Person uses GeneratePanel") @slice("Generate code") @note("Builders are pure: plan in, files out. Scenarios become failing tests and deciders start as scaffolds, so the suite starts red. Generated files are always rewritten; scaffolds are written once and never touched again.") @planned @story("As a Person, I want to generate code, so that the code is generated.")
    --[a slice in scope is incomplete or out of order]--> reject MODEL_NOT_READY
    --[a scenario names an event that isn’t in the model]--> reject SCENARIO_UNKNOWN_EVENT
    --[default]--> [CodeGenerated { buildId: id, revision: number, builderId: text }]

  Person -> downloadCode(buildId: id) in Build(buildId) @note("Person uses GeneratePanel") @slice("Download generated code") @note("A zip with a manifest of the model revision, builder and each file’s ownership and hash, so a later generation can show what changed.") @planned @story("As a Person, I want to download generated code, so that the code is downloaded.")
    --[default]--> [CodeDownloaded { buildId: id }]

  Sponsor -> registerBuilder(builderId: text, version: text, accepts: text) in Build(buildId) @note("Sponsor uses BuildersPage") @slice("Add a builder") @note("Builders, port contracts and conformance suites are public and versioned. Community builders run sandboxed, with no network or files. Planning stays in the closed core.") @planned @story("As a Sponsor, I want to add a builder, so that the builder is registered.")
    --[the builder doesn’t accept this version of the plan]--> reject PLAN_VERSION_UNSUPPORTED
    --[default]--> [BuilderRegistered { buildId: id, builderId: text, version: text }]

  Person -> generateIntoAnExistingCodebase() @note("Person uses GenerateIntoAnExistingCodebaseTrigger") @slice("Generate into an existing codebase") @note("Drafted from REQ-1150. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [GenerateIntoAnExistingCodebaseRecorded]

  Person -> runABuilderFromExistingScaffoldingTools() @note("Person uses RunABuilderFromExistingScaffoldingToolsTrigger") @slice("Run a builder from existing scaffolding tools") @note("Drafted from REQ-1151. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [RunABuilderFromExistingScaffoldingToolsRecorded]

  Person -> checkAnAdapterAgainstItsPort() @note("Person uses CheckAnAdapterAgainstItsPortTrigger") @slice("Check an adapter against its port") @note("Drafted from REQ-1152. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [CheckAnAdapterAgainstItsPortRecorded]

  Person -> fillInADeciderAnAgentWrites() @note("Person uses FillInADeciderAnAgentWritesTrigger") @slice("Fill in a decider an agent writes") @note("Drafted from REQ-1153. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [FillInADeciderAnAgentWritesRecorded]

  Person -> planBuildsOnTheServer() @note("Person uses PlanBuildsOnTheServerTrigger") @slice("Plan builds on the server") @note("Drafted from REQ-1154. Its elements are placeholders until someone confirms it.") @planned @story("")
    --[default]--> [PlanBuildsOnTheServerRecorded]

}

