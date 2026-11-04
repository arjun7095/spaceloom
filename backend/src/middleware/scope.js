import mongoose from 'mongoose';
import { Property } from '../models/index.js';
import { als } from '../lib/context.js';
import { ah, bad, forbidden, notFound } from '../lib/http.js';

const cache = new Map();
export const clearPropertyCache = (id) => (id ? cache.delete(String(id)) : cache.clear());

// Resolves the active property from X-Property-Id (or the user's first property), checks access,
// and runs the rest of the request inside a context the Mongoose plugin uses to scope queries.
export const propertyScope = ah(async (req, res, next) => {
  const u = req.user;
  let pid = req.get('X-Property-Id') || u.propertyIds[0];
  if (pid && !mongoose.isValidObjectId(pid)) throw bad('Invalid property');
  if (!pid && u.isSuper) pid = String((await Property.findOne().select('_id').lean())?._id || '');
  if (pid && !u.isSuper && !u.propertyIds.includes(pid)) throw forbidden('You do not have access to this property');
  let property = pid ? cache.get(pid) : null;
  if (pid && !property) {
    property = await Property.findById(pid).select('orgId code name city timezone is24x7 operatingHours geoFence slaPolicyId approvalLimits settings').lean();
    if (!property) throw notFound('Property');
    cache.set(pid, property);
  }
  req.property = property;
  als.run({ propertyId: property?._id, orgId: property?.orgId, userId: u._id, userName: u.name, ip: req.ip }, next);
});
