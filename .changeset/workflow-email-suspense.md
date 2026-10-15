---
'@shware/workflow': patch
---

`registryRenderer` streams the email and waits for every Suspense boundary before returning the HTML, so react-email's `<Tailwind>` (which suspends while compiling classes) renders on the Worker; a component that throws rejects the render.
