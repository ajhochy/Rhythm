---
name: document-creation
description: Create PowerPoint decks, Word documents, Excel workbooks, CSV files, and PDFs from scratch when a user requests a native office document.
---

# Document Creation

Use this skill only to create a new `.pptx`, `.docx`, `.xlsx`, `.csv`, or `.pdf` file.

## Toolchain

Use the Rhythm-managed environment under the current user's Application Support directory:

```sh
"$HOME/Library/Application Support/Rhythm/creative-tools/document-tools/.venv/bin/python"
```

Use the smallest suitable library:

- `.pptx`: `python-pptx`
- `.docx`: `python-docx`
- `.xlsx`: `openpyxl`
- `.csv`: Python `csv` module
- `.pdf`: `reportlab`

## Workflow

1. Confirm the requested format, content, filename, and destination if any is unclear.
2. Create the file directly; do not substitute a different format.
3. Make parent directories only when needed. Never overwrite an existing file without the user's explicit confirmation.
4. Verify it: reopen `.pptx`, `.docx`, and `.xlsx` with their creation library; parse `.csv`; confirm a `.pdf` is non-empty.
5. Report the exact saved path and format. Use the `creative-media` profile for visual art direction or elaborate branding when needed.

## Constraints

- Generate PDFs directly with ReportLab; do not depend on Office, LibreOffice, or a conversion service.
- Keep document generation self-contained. Do not install packages, change the virtual environment, or add a new MCP during a document request.
- Use clear headings, sensible tables, and readable defaults. Do not claim a document was verified unless the verification step passed.
