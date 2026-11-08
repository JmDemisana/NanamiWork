# NanamiWork profile isolation

NanamiWork stores desktop runtime state under its Electron user-data directory in `nanamiwork-runtime`. Its existing account configuration stays under `~/.config/nanamiwork`, with separate XDG data, cache, state and engine-home folders. Explicit path overrides still take precedence and can intentionally select shared locations.

On the first launch after upgrading, NanamiWork asks before copying earlier files from the shared OpenWork runtime. That directory can contain chats, workspace settings and connection credentials belonging to another installation. Only choose import if those files are yours. The source is not removed or overwritten. If v1 history is only in the shared OpenCode database, a separate confirmation is required. OpenCode's shared `auth.json` is never imported automatically; accounts stored only there may need reconnecting.

Close any other application using the old runtime before importing. SQLite databases are snapshotted using SQLite's backup API, including committed WAL data. An interrupted v1-to-v2 copy is retained with a rewritten private checkpoint, or the import fails without replacing either profile. Workspace lists, desktop preferences and NanamiWork's existing account files stay in their existing private locations.

The managed engines use a private home to avoid plugins discovering or moving another agent's state. On Windows their `APPDATA` and `LOCALAPPDATA` are private too. Shells launched by the managed engines can use `NANAMIWORK_REAL_HOME` to refer to the original home directory. The desktop's normal home and user-data paths do not change.

The v2 engine cannot yet mirror v1 OAuth sign-ins automatically. NanamiWork therefore pauses automatic v2 routing when v1 sign-ins are present instead of silently disconnecting those accounts. An explicit engine selection remains available.
