// Minimal ambient for the Chrome extension build. The extension surface (B5)
// is still a TBD; this keeps the shared code typechecking without pulling in
// the full @types/chrome dependency.
declare const chrome: any
