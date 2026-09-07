module.exports = function resolveOpportunityId(row, { lookup }) {
  const opportunity = lookup('Existing Opportunities', 'Name', row.Name);
  if (!opportunity) {
    throw new Error(`Opportunity "${row.Name}" was not found.`);
  }
  row.Id = opportunity.Id;
  return row;
};
