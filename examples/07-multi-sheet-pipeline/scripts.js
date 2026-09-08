const { prepareActivity } = require('./activity-transform');

module.exports = {
  // >>> action: Prepare Account Updates
  'Prepare Account Updates': function (row, { lookup }) {
    const existing = lookup('Salesforce Accounts', 'Name', row.Name);
    if (!existing) {
      throw new Error(`Account "${row.Name}" was not found.`);
    }
    row.Id = existing.Id;
    return row;
  },
  // <<< action: Prepare Account Updates

  // >>> action: Prepare Standard Activities
  'Prepare Standard Activities': function (row, context) {
    return prepareActivity(row, context, false);
  },
  // <<< action: Prepare Standard Activities

  // >>> action: Prepare High Priority Activities
  'Prepare High Priority Activities': function (row, context) {
    return prepareActivity(row, context, true);
  },
  // <<< action: Prepare High Priority Activities
};
