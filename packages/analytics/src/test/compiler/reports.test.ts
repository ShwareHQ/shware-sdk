import type { CompilerReport } from './plugin.test';

// Each transformed module registers itself when it executes in the Compiler test project.
// An untransformed hook therefore leaves a missing report instead of silently testing baseline.
export const compilerReports: CompilerReport[] = [];
