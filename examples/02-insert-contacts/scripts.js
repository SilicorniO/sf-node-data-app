module.exports = {
  // >>> action: Resolve Contact Accounts
  'Resolve Contact Accounts': function (row, { lookup }) {
    const account = lookup('Accounts', 'Name', row.AccountId);
    if (!account) {
      throw new Error(`Account "${row.AccountId}" was not found.`);
    }
    row.AccountId = account.Id;
    return row;
  },
  // <<< action: Resolve Contact Accounts
};
