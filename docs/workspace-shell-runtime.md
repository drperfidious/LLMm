# Workspace Shell Runtime

LLMm currently ships a built-in workspace shell for agent/file workflows. It is
not native bash. It runs inside the app sandbox and only touches files under the
LLMm workspace directory.

## Current Runtime

The built-in runtime supports project-style file work:

- navigation: `pwd`, `cd`, `ls`, `tree`
- inspection: `cat`, `head`, `tail`, `wc`, `stat`, `grep`
- mutation: `touch`, `mkdir`, `rm`, `cp`, `mv`, `write`, `append`, `echo >`,
  `echo >>`
- scripting: `run <script.llsh>` for the same LLMm shell commands
- session state: `env`, `export KEY=value`, `unset KEY`, `which`
- runtime discovery: `runtime`, `pkg list`, `pkg search`

Commands that require native processes or package managers, including `python`,
`pip`, `conda`, `mamba`, `apk`, `node`, `npm`, `sh`, and `bash`, are recognized
and rejected with an explicit runtime-provider error.

## iSH Option

[iSH](https://github.com/ish-app/ish) is open source and already proves that a
Linux-like shell can run on iOS via user-mode x86 emulation and syscall
translation. It is not a drop-in SDK in the current project shape. Integrating
it would be a native runtime project:

- audit GPLv2/GPLv3 and iOS-specific license terms,
- bundle or generate the Linux root filesystem in an App Store-safe way,
- bridge stdin/stdout/stderr and process lifecycle into React Native,
- map the LLMm workspace into the emulated filesystem,
- constrain network/package-manager behavior to user-visible, editable code,
- add crash/memory limits for older A-series devices.

## App Store Boundary

[Apple App Review Guideline 2.5.2](https://developer.apple.com/app-store/review/guidelines/)
requires apps to stay self-contained and restricts downloading, installing, or
executing code that changes app functionality. Developer/educational code
execution has limited allowance when the source is user-visible and editable.
That makes a bundled runtime plausible, but a remote package manager must be
designed carefully and documented for review.

## Next Runtime Milestones

1. Keep improving the built-in workspace shell for deterministic agent file
   workflows.
2. Add a runtime-provider interface behind the current `runtime` and `pkg`
   commands.
3. Prototype a bundled WASI/Python provider for scripts before attempting a full
   Linux userland.
4. Evaluate an iSH-derived runtime only after license, memory, App Store review,
   and bridge costs are acceptable.
