# CLAUDE.md - Backend Documentation

## Database Schema & Structure

### Content-Submission Relationship

The database uses a **dual-collection architecture** where submissions reference content through ID arrays.

#### Collections Overview
- **submissions**: 336 documents (main submission metadata)
- **contents**: 901 documents (actual content pieces)

#### ID Type Architecture

**Submissions Collection**:
- `_id`: MongoDB ObjectId
- `contentIds`: Array of ObjectIds pointing to content documents
- Example: `contentIds: [ObjectId("689458e40423ee6b0e5f5f38")]`

**Contents Collection**:
- `_id`: **String** (not ObjectId)
- `submissionId`: String pointing to submission document
- Example: `_id: "689458e40423ee6b0e5f5f38"`, `submissionId: "689458e40423ee6b0e5f5f3a"`

#### Relationship Structure
```
Submission (ObjectId) → contentIds: [String, String, ...] → Content (_id: String)
Content (submissionId: String) ← references ← Submission (_id: ObjectId)
```

#### Custom Population Implementation

Since content documents use string `_id`s, standard Mongoose populate doesn't work. The system uses **manual population**:

```javascript
// In models/Submission.js - findBySlug method
submissionSchema.statics.findBySlug = async function(slug) {
  const submission = await this.findOne({ 
    'seo.slug': slug, 
    status: 'published' 
  }).populate('userId', 'name username email profileImage');
  
  if (!submission) return null;
  
  if (submission.contentIds && submission.contentIds.length > 0) {
    // Convert ObjectIds to strings for querying content collection
    const contentIdStrings = submission.contentIds.map(id => id.toString());
    
    // Direct MongoDB query bypasses Mongoose type conversion
    const contents = await this.db.collection('contents').find({
      _id: { $in: contentIdStrings }
    }).toArray();
    
    // Return plain objects to avoid serialization issues
    const plainContents = contents.map(content => ({
      _id: content._id,
      title: content.title,
      body: content.body,
      tags: content.tags || [],
      footnotes: content.footnotes || '',
      seo: content.seo || {},
      viewCount: content.viewCount || 0,
      isFeatured: content.isFeatured || false,
      createdAt: content.createdAt
    }));
    
    const submissionObj = submission.toObject();
    submissionObj.contentIds = plainContents;
    return submissionObj;
  }
  
  return submission;
};
```

#### Data Consistency Rules

1. **Content ID Format**: All content `_id`s are strings
2. **Reference Format**: Submission `contentIds` arrays contain ObjectIds that stringify to match content `_id`s
3. **Population Method**: Always use direct MongoDB queries for content population
4. **Return Format**: Convert to plain JavaScript objects to avoid Mongoose document serialization

#### API Endpoints

**GET /api/submissions/by-slug/:slug**
- Returns submission with populated content array
- Content objects include: `_id`, `title`, `body`, `tags`, `footnotes`, `seo`, `viewCount`, `isFeatured`, `createdAt`

#### Example Data Structure

```javascript
// Submission document
{
  _id: ObjectId("689458e40423ee6b0e5f5f3a"),
  title: "Night of the Scorpion",
  contentIds: [ObjectId("689458e40423ee6b0e5f5f38")],
  status: "published",
  seo: { slug: "night-of-the-scorpion" }
}

// Content document  
{
  _id: "689458e40423ee6b0e5f5f38",
  title: "Night of the Scorpion",
  body: "I remember the night my mother...",
  submissionId: "689458e40423ee6b0e5f5f3a",
  tags: [],
  footnotes: ""
}
```

This architecture supports the single-source-of-truth pattern where submissions control publication status while maintaining efficient content storage and retrieval.

## Fixed API Endpoints

The following endpoints have been updated to use the custom population implementation:

### Submission Endpoints
- **GET /api/submissions/:id/contents**: Uses `SubmissionService.getSubmissionWithContent()`
- **GET /api/submissions/:id/review**: Uses `SubmissionService.getSubmissionWithContent()`
- **GET /api/submissions/by-slug/:slug**: Uses `Submission.findBySlug()` static method

### Service Methods Updated
- `SubmissionService.getSubmissionWithContent()`: Manual population with contents array
- `SubmissionService.getPublishedSubmissionDetails()`: Manual population for published content
- `SubmissionService.getUserSubmissions()`: Batch population for user submissions
- `UserService.getUserSubmissions()`: Uses helper method for content population

### Review System Fix
- **POST /api/reviews/:id/action**: Now accepts 'shortlist' action in addition to 'approve', 'reject', 'revision'
- Updated action validation and handling for shortlist workflow

All methods now return populated content arrays with proper title, body, tags, footnotes, and other fields.