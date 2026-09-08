module.exports = {
  // >>> action: Prepare New Opportunities
  'Prepare New Opportunities': function (row, { lookup }) {
    if (lookup('Existing Opportunities', 'Name', row.Name)) {
      return null;
    }
    const account = lookup('Accounts', 'Name', row.AccountId);
    if (!account) {
      throw new Error(`Account "${row.AccountId}" was not found.`);
    }
    row.AccountId = account.Id;
    return row;
  },
  // <<< action: Prepare New Opportunities
};
