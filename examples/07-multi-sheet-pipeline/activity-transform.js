function prepareActivity(row, { lookup }, includeHighPriority) {
  const isHighPriority = row.Priority === 'High';
  if (isHighPriority !== includeHighPriority) return null;
  if (lookup('Existing Tasks', 'Subject', row.Subject)) return null;

  const contact = lookup('Contacts', 'Email', row.WhoId);
  if (!contact) throw new Error(`Contact "${row.WhoId}" was not found.`);
  const account = lookup('Salesforce Accounts', 'Name', row.WhatId);
  if (!account) throw new Error(`Account "${row.WhatId}" was not found.`);

  row.WhoId = contact.Id;
  row.WhatId = account.Id;
  row.Status = 'Not Started';
  return row;
}

module.exports = { prepareActivity };
