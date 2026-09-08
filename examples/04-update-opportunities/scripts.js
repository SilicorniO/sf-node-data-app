module.exports = {
  // >>> action: Resolve Opportunity IDs
  'Resolve Opportunity IDs': function (row, { lookup }) {
    const opportunity = lookup('Existing Opportunities', 'Name', row.Name);
    if (!opportunity) {
      throw new Error(`Opportunity "${row.Name}" was not found.`);
    }
    row.Id = opportunity.Id;
    return row;
  },
  // <<< action: Resolve Opportunity IDs
};
