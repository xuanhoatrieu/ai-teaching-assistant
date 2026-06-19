# US-019 Syllabus 2026 Import and Export Template Alignment

## Status

done

## Lane

normal

## Product Contract

Syllabus import and export must strictly align with the TUAF 2026 syllabus template. When importing a legacy or non-standard docx file, the AI must semantically extract relevant fields and populate them into the correct positions of the standard 10-block template. Any legacy sections or content that do not belong to the standard template should be ignored. When exporting, the syllabus document must render the cover/header page dynamically using the editable `header` block content, instead of using a hardcoded title layout, while maintaining correct formatting.

## Acceptance Criteria

1. **AI Parsing Prompt**:
   - Instruct the AI with the exact markdown structures and tables of the standard 2026 template (using the default templates defined in the system).
   - Require the AI to reconstruct each block's output content to strictly follow the template format, replacing placeholders (e.g. `……`, `.....`) only with corresponding data extracted from the source document.
   - Retain default placeholders or table rows/structures if no relevant information is present in the source document.
   - Ignore and discard any source content that does not map to any template field or block.

2. **Export to DOCX**:
   - Do not skip the `header` block during export. Omit printing the block title `"Thông tin chung đề cương"`, but render its content (the cover page table and title texts) at the very top of the generated Word document.
   - Remove the hardcoded `buildTitlePage` function to prevent duplication and layout mismatch.
   - Ensure all tables (including header, general info, lecturers, clo, assessment, and content detail) are rendered with correct margins, fonts, borders, and column layouts matching the 2026 template.

## Design Notes

- Update the AI prompt `SYLLABUS_PARSE_SYSTEM_PROMPT` in `syllabus.service.ts` to include the standard block templates and clear matching instructions.
- Update `generateDocx` in `syllabus-export.service.ts` to include the `header` block and remove `buildTitlePage`.
- Test using the uploaded standard and non-standard DOCX syllabus files.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `npm run test:unit` passes (or specific syllabus test specs pass) |
| Integration | Upload legacy DOCX syllabus -> database blocks are correctly populated in 2026 format, and export matches the design. |
