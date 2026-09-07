import { validateAction } from './validation.js';
import { buildActionConfiguration } from './yaml.js';

export function validateActionDraft(action, otherActions = []) {
  const issues = validateAction(buildActionConfiguration(action));
  const normalizedName = action.name.trim().toLowerCase();
  if (normalizedName && otherActions.some(item => item.name.trim().toLowerCase() === normalizedName)) {
    issues.push({ path: ['name'], pathText: 'name', message: 'Action names must be unique ignoring case' });
  }
  return issues;
}

export function issuesByField(issues) {
  return issues.reduce((result, issue) => {
    const field = String(issue.path[0] || 'action');
    (result[field] ||= []).push(issue.message);
    return result;
  }, {});
}
