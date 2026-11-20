/**
 * Type declarations for the plain-JS custom promptfoo assertions.
 * These modules are ESM JavaScript (no .d.ts of their own) and are eslint-
 * ignored (framework/promptfoo/**). Declared here so tsc can type-check
 * promptfooconfig.ts which dynamically imports them.
 */
declare module './assertions/assertToolsCalled.js' {
  const defaultExport: (opts?: Record<string, unknown>) => unknown;
  export default defaultExport;
}
declare module './assertions/assertNoToolCalled.js' {
  const defaultExport: (opts?: Record<string, unknown>) => unknown;
  export default defaultExport;
}
declare module './assertions/assertDbConsistent.js' {
  const defaultExport: (opts?: Record<string, unknown>) => unknown;
  export default defaultExport;
}
declare module './assertions/assertNoPiiInOutbound.js' {
  const defaultExport: (opts?: Record<string, unknown>) => unknown;
  export default defaultExport;
}
