# Route Consolidation Proposal

## Current Issues Fixed:
1. ✅ Removed duplicate `/user/me` route in submissionRoutes.js
2. ✅ Removed deprecated poetry-analysis.js (functionality moved to submissionRoutes.js)

## Potential Consolidations (Future Improvements):

### 1. Authentication & User Operations
**Current:**
- `/api/auth/register`
- `/api/auth/login` 
- `/api/users/:id/approve-bio`
- `/api/users/:id/approve-profile-image`

**Proposed:**
- `/api/auth/register`
- `/api/auth/login`
- `/api/users/:id/approve?type=bio|profileImage`

### 2. Submission Status & Filtering
**Current:**
- `/api/submissions/published`
- `/api/submissions/featured`
- `/api/submissions/types`
- `/api/submissions/search/:query`

**Proposed:**
- `/api/submissions?status=published&featured=true&includeTypes=true&search=query`

### 3. Review Actions
**Current:**
- `/api/reviews/:id/approve`
- `/api/reviews/:id/reject`
- `/api/reviews/:id/revision`

**Proposed:**
- `/api/reviews/:id/action` with body: `{action: 'approve|reject|revision', ...}`

### 4. Content Discovery
**Current:**
- `/api/content/published`
- `/api/content/by-tag/:tag`
- `/api/content/by-author/:userId`

**Proposed:**
- `/api/content?published=true&tag=tagname&author=userId`

## Benefits:
- Reduced route duplication
- Consistent query parameter patterns
- Easier API maintenance
- Better caching opportunities
- Cleaner OpenAPI/Swagger documentation

## Implementation Priority:
1. HIGH: Remove duplicate imports and unused routes (DONE)
2. MEDIUM: Consolidate submission filtering routes
3. LOW: Consolidate review action routes (breaking change)