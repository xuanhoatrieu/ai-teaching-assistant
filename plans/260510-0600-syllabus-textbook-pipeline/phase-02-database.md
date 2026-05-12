# Phase 02: Database Models + Migration
Status: ⬜ Pending
Dependencies: None
Risk: Normal

## Objective
Tạo 4 Prisma models mới (Syllabus, SyllabusBlock, SyllabusReference, SyllabusLesson) + relations.

## Implementation Steps

1. [ ] **Thêm models vào schema.prisma**
   - `Syllabus` (1:1 với Subject)
   - `SyllabusBlock` (1:N với Syllabus, types: header/general_info/lecturers/description/clo/materials/student_tasks/assessment/content_detail/update_log)
   - `SyllabusReference` (1:N với Syllabus, file upload + markdown)
   - `SyllabusLesson` (1:N với Syllabus, optional 1:1 với Lesson)
   - Relations: Subject.syllabus, Lesson.syllabusLesson

2. [ ] **Run migration**
   - `npx prisma migrate dev --name add_syllabus_models`
   - Verify: tables created, relations correct

3. [ ] **Generate client**
   - `npx prisma generate`
   - Verify: types available in IDE

## Schema Detail

```prisma
model Syllabus {
  id        String   @id @default(uuid())
  subjectId String   @unique @map("subject_id")
  status    String   @default("draft")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  subject    Subject           @relation(fields: [subjectId], references: [id], onDelete: Cascade)
  blocks     SyllabusBlock[]
  references SyllabusReference[]
  lessons    SyllabusLesson[]
  @@map("syllabi")
}

model SyllabusBlock {
  id         String   @id @default(uuid())
  syllabusId String   @map("syllabus_id")
  blockType  String   @map("block_type")
  title      String
  content    String   @db.Text
  metadata   Json?
  sortOrder  Int      @default(0) @map("sort_order")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  syllabus Syllabus @relation(fields: [syllabusId], references: [id], onDelete: Cascade)
  @@map("syllabus_blocks")
}

model SyllabusReference {
  id              String   @id @default(uuid())
  syllabusId      String   @map("syllabus_id")
  fileName        String   @map("file_name")
  fileUrl         String   @map("file_url")
  fileSize        Int?     @map("file_size")
  markdownContent String?  @map("markdown_content") @db.Text
  status          String   @default("pending")
  createdAt       DateTime @default(now()) @map("created_at")

  syllabus Syllabus @relation(fields: [syllabusId], references: [id], onDelete: Cascade)
  @@map("syllabus_references")
}

model SyllabusLesson {
  id              String   @id @default(uuid())
  syllabusId      String   @map("syllabus_id")
  sortOrder       Int      @map("sort_order")
  title           String
  outline         String   @db.Text
  textbookContent String?  @map("textbook_content") @db.Text
  textbookStatus  String   @default("none") @map("textbook_status")
  lessonId        String?  @unique @map("lesson_id")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  syllabus Syllabus @relation(fields: [syllabusId], references: [id], onDelete: Cascade)
  lesson   Lesson?  @relation(fields: [lessonId], references: [id], onDelete: SetNull)
  @@map("syllabus_lessons")
}
```

## Test Criteria
- [ ] Migration runs without errors
- [ ] `prisma studio` shows new tables
- [ ] Cascade delete: delete Subject → deletes Syllabus → deletes all blocks/refs/lessons

---
Next Phase: → phase-03-syllabus-blocks.md
