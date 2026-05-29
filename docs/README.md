# BatchImager Docs

Current design authority:

- [tools-design.json](./tools-design.json): source of truth for agent provider, workbench capability, action, permission, preflight, and tool contracts.
- [tools-design.html](./tools-design.html): local viewer for the same tool design data.

Historical Esse version plans live in [archive](./archive/). They are kept for context only and should not be used as implementation guidance for new work. New development should treat the right panel as an agent provider host: Esse is the first provider, while BatchImager owns the workbench APIs that any provider adapter must use.
