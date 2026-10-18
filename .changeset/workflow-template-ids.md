---
'@shware/workflow': major
---

Templates carry their own identity: `emailTemplate`, `pushTemplate`, `discordTemplate` and `slackTemplate` take a required `id`, and `.email()`, `.push()`, `.discord()`, `.slack()` and `.prefer()` take the definition itself, with props typed by its schema. `compileConfig`, `registryValidator`, the renderers and the senders find a template by its `id` (unique per channel; a duplicate fails), and a workflow must send the very definition registered under that id. The IR is unchanged.

Migrating: give every template `id: '<its old registry key>'`, replace `t.email.<key>` with the definition (`email.<name>`), and register the channel objects directly (`templates: { email, push }`). `templates()`, `TemplateRefs`, `TemplateRefTable` and `template.email` / `push` / `slack` / `discord` are removed; `template.sms` / `inApp` / `survey` remain for channels without definitions. `compileBundle`'s `templates` now takes definitions, and `parseTemplateProps` / `render*Content` no longer take a key.
