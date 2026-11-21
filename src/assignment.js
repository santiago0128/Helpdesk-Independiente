const positiveInt = (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export const selectAutomaticAssignee = (candidates = []) => [...candidates]
  .filter((candidate) => positiveInt(candidate?.id))
  .sort((left, right) => {
    const loadDifference = Number(left.active_ticket_count || 0) - Number(right.active_ticket_count || 0);
    if (loadDifference) return loadDifference;
    const leftLastAssignment = left.last_assignment_at ? new Date(left.last_assignment_at).getTime() : 0;
    const rightLastAssignment = right.last_assignment_at ? new Date(right.last_assignment_at).getTime() : 0;
    if (leftLastAssignment !== rightLastAssignment) return leftLastAssignment - rightLastAssignment;
    return Number(left.id) - Number(right.id);
  })[0] || null;
