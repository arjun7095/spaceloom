import { ApprovalRule, Delegation, User } from '../models/index.js';
import { forbidden } from './http.js';
import { notify, usersWithRole } from './notify.js';

const ROLE_LABEL = { supervisor: 'Supervisor', property_manager: 'Property Manager', owner: 'Owner', hse_officer: 'HSE Officer' };

// Users who delegated their approvals to `userId` for today (FR-2.4).
async function delegatorRoles(userId) {
  const now = new Date();
  const ds = await Delegation.find({ toUserId: userId, active: true, from: { $lte: now }, to: { $gte: now } }).lean();
  if (!ds.length) return [];
  const users = await User.find({ _id: { $in: ds.map((d) => d.fromUserId) } }).populate('roleIds', 'key').lean();
  return users.flatMap((u) => u.roleIds.map((r) => r.key));
}

export async function canApproveLevel(user, doc) {
  if (user.isSuper) return true;
  const levelRole = doc.approvalLevels?.[doc.currentLevel || 0];
  if (!levelRole) return true;
  if (user.roles.includes(levelRole)) return true;
  return (await delegatorRoles(user._id)).includes(levelRole);
}

// Transition config for multi-level approvals (FR-2.3). On "approved" the document only becomes
// approved after the last level; otherwise it stays pending and moves to the next approver.
export function approvalTransitions({ pending = 'submitted', approved = 'approved', rejected = 'rejected', perm, extraMap = {}, onApproved, link }) {
  return {
    map: { [pending]: [approved, rejected], ...extraMap },
    perms: { [approved]: perm, [rejected]: perm },
    guard: async (doc, to, req) => {
      if ((to === approved || to === rejected) && !(await canApproveLevel(req.user, doc))) {
        const need = ROLE_LABEL[doc.approvalLevels?.[doc.currentLevel]] || doc.approvalLevels?.[doc.currentLevel];
        throw forbidden(`This is waiting for the ${need} to approve`);
      }
    },
    onEnter: {
      [approved]: async (doc, req) => {
        const last = (doc.approvalLevels?.length || 1) - 1;
        if ((doc.currentLevel || 0) < last) {
          doc.currentLevel = (doc.currentLevel || 0) + 1;
          doc.status = pending;
          const next = await usersWithRole(doc.propertyId, [doc.approvalLevels[doc.currentLevel]]);
          await notify({ userIds: next.map((u) => u._id), propertyId: doc.propertyId, type: 'approval', title: 'Approval needed', body: `${doc.number || doc.constructor.modelName} is waiting for your approval`, link: link?.(doc) });
          return;
        }
        await onApproved?.(doc, req);
      },
    },
  };
}

// Default chains, used until an admin edits Setup → Approval rules. A level with minAmount only
// applies when the amount is above it (e.g. the owner signs POs above ₹2,00,000).
export const DEFAULT_APPROVAL_RULES = {
  leave_request: [{ role: 'supervisor' }],
  overtime_request: [{ role: 'supervisor' }],
  regularization: [{ role: 'supervisor' }],
  contractor_deployment: [{ role: 'supervisor' }],
  purchase_request: [{ role: 'supervisor' }, { role: 'property_manager' }, { role: 'owner', minAmount: 100000 }],
  purchase_order: [{ role: 'property_manager' }, { role: 'owner', minAmount: 200000 }],
  amc_renewal: [{ role: 'property_manager' }, { role: 'owner' }],
  permit: [{ role: 'hse_officer' }],
};

export async function approvalLevels(entityType, amount = 0) {
  const rule = await ApprovalRule.findOne({ entityType, active: { $ne: false } }).lean();
  const levels = rule?.levels?.length ? rule.levels : DEFAULT_APPROVAL_RULES[entityType] || [{ role: 'property_manager' }];
  return levels.filter((l) => !l.minAmount || amount > l.minAmount).map((l) => l.role);
}
