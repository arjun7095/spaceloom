import mongoose from 'mongoose';
import { ctx } from '../lib/context.js';

const { ObjectId } = mongoose.Schema.Types;
const QUERY_HOOKS = ['find', 'findOne', 'countDocuments', 'findOneAndUpdate', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany'];

// scope: 'property' → orgId + propertyId, 'org' → orgId only, 'none' → global collection.
// Queries skip soft-deleted rows and are filtered to the active property/org from the request
// context. Pass .setOptions({ withDeleted: true }) or { unscoped: true } to opt out.
export function basePlugin(schema, { scope = 'property' } = {}) {
  schema.add({
    orgId: { type: ObjectId, ref: 'Organization', index: true },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    deletedBy: { type: ObjectId, ref: 'User' },
  });
  if (scope === 'property') schema.add({ propertyId: { type: ObjectId, ref: 'Property', index: true } });
  schema.set('timestamps', true);
  schema.set('toJSON', { versionKey: false });

  const scopeFilter = () => {
    const c = ctx();
    if (scope === 'property' && c.propertyId) return { propertyId: c.propertyId };
    if (scope === 'org' && c.orgId) return { orgId: c.orgId };
    return {};
  };

  schema.pre(QUERY_HOOKS, function () {
    const opts = this.getOptions();
    const filter = this.getFilter();
    if (!opts.withDeleted && filter.isDeleted === undefined) this.where({ isDeleted: { $ne: true } });
    if (!opts.unscoped) {
      const s = scopeFilter();
      for (const k of Object.keys(s)) if (filter[k] === undefined) this.where({ [k]: s[k] });
    }
  });

  schema.pre('aggregate', function () {
    if (this.options?.unscoped) return;
    this.pipeline().unshift({ $match: { isDeleted: { $ne: true }, ...scopeFilter() } });
  });

  schema.pre('validate', function () {
    const c = ctx();
    if (this.isNew) {
      if (!this.orgId && c.orgId) this.orgId = c.orgId;
      if (scope === 'property' && !this.propertyId && c.propertyId) this.propertyId = c.propertyId;
      if (!this.createdBy && c.userId) this.createdBy = c.userId;
    }
    if (c.userId) this.updatedBy = c.userId;
  });
}
