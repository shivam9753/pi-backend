const Audit = require('../models/Audit');

/**
 * AuditService — thin wrapper around Audit.create().
 *
 * Usage:
 *   await AuditService.log({
 *     submissionId, action, resultingStatus,
 *     userId, notes
 *   });
 */
class AuditService {

  /**
   * Write a single audit entry.
   *
   * @param {object} opts
   * @param {string}  opts.submissionId
   * @param {string}  opts.action          - one of AUDIT_ACTIONS
   * @param {string}  opts.resultingStatus - submission.status after the action
   * @param {string}  opts.userId
   * @param {string}  [opts.notes]
   */
  static async log({ submissionId, action, resultingStatus, userId, notes = '' }) {
    if (!submissionId || !action || !resultingStatus || !userId) {
      console.warn('AuditService.log: missing required fields', { submissionId, action, resultingStatus, userId });
      return null;
    }

    try {
      return await Audit.create({
        submissionId: String(submissionId),
        action,
        resultingStatus,
        userId: String(userId),
        notes: notes || ''
      });
    } catch (err) {
      // Never let an audit write break the main flow
      console.error('AuditService.log failed:', err && (err.message || err));
      return null;
    }
  }

  /**
   * Fetch full audit trail for a submission, newest-first.
   *
   * @param {string} submissionId
   * @returns {Promise<Array>}
   */
  static async getTrail(submissionId) {
    return Audit.find({ submissionId: String(submissionId) })
      .sort({ createdAt: 1 })
      .populate('userId', 'name username email')
      .lean();
  }

  /**
   * Delete all audit entries for given submission IDs (used when purging submissions).
   */
  static async deleteBySubmissionIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    return Audit.deleteMany({ submissionId: { $in: ids.map(String) } });
  }

  /**
   * Check if a submission was ever published (used to preserve publishedAt).
   */
  static async wasEverPublished(submissionId) {
    const hit = await Audit.findOne({
      submissionId: String(submissionId),
      action: { $in: ['published', 'republished'] }
    }).select('_id').lean();
    return !!hit;
  }
}

module.exports = AuditService;
