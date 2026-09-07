module.exports = function prepareAccount(row, { lookup }) {
  const existing = lookup('Salesforce Accounts', 'Name', row.Name);
  if (!existing) {
    throw new Error(`Account "${row.Name}" was not found.`);
  }
  row.Id = existing.Id;
  return row;
};
