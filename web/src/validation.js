import { actionSchema, execConfSchema } from '../../src/schema/ExecConfSchema.ts';

export function validateConfiguration(configuration) {
  const result = execConfSchema.safeParse(configuration);
  if (result.success) {
    return { valid: true, data: result.data, issues: [] };
  }
  return {
    valid: false,
    data: null,
    issues: result.error.issues.map(issue => ({
      path: issue.path,
      pathText: issue.path.join('.'),
      message: issue.message,
      section: sectionForPath(issue.path),
      actionIndex: issue.path[0] === 'actions' && typeof issue.path[1] === 'number'
        ? issue.path[1]
        : null,
    })),
  };
}

export function validateAction(action) {
  const result = actionSchema.safeParse(action);
  if (result.success) return [];
  return result.error.issues.map(issue => ({
    path: issue.path,
    pathText: issue.path.join('.'),
    message: issue.message,
  }));
}

function sectionForPath(path) {
  if (path[0] === 'actions') return 'actions';
  if (path[0] === 'sheets') return 'sheets';
  return 'app';
}
