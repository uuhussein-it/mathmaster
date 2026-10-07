Question types (widening): add explicit 'type' field (mcq|multi|matching|complete|dropdown|fr). 
- matching/complete can be rendered as ordered matching (pairs) or converted to MCQ per item. 
- dropdown can be select per blank. 
- multi-select already exists.

But need frontend + backend changes to store/render. Also DB schema could gain 'qtype' column (optional). For now, keep backward compatible: add 'type' in API dict (infer from content: if has blanks+multiple columns or "match each" -> 'matching'; if "complete" table -> 'complete'; else existing).

Claude integration: I created:
- data/match_complete_export.json (65 questions to seed variants)
- data/claude_gen_prompt.txt (prompt to paste into Claude)
- backend/import_variants.py (import generated variants.json)

Workflow:
1. Paste match_complete_export.json + prompt into Claude and get variants.json
2. python3 backend/import_variants.py variants.json
3. commit data/sat.db

To connect "live" to Claude in-app: add an admin endpoint that calls Claude API (needs CLAUDE_API_KEY env). I can add that if you want.
