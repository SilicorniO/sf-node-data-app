const { prepareActivity } = require('./activity-transform');

module.exports = function prepareHighPriorityActivity(row, context) {
  return prepareActivity(row, context, true);
};
