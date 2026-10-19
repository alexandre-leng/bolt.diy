# Bolt fork documentation

- [Self-hosted architecture, validation and delivery](docs/self-hosted-bolt.md)
- [Application README](../README.md)
- [Append-only implementation journal](../memory.md)
- [External-service patches and application instructions](../patches/README.md)

The `docs/` subdirectory is the MkDocs source directory. Fork-specific behavior
is documented in the self-hosted guide; upstream pages remain useful background
but may describe the removed StackBlitz runtime.

This documentation distinguishes source/test evidence from production delivery.
A pushed commit or a passing application build does not apply a host-service
patch, restart a service, or validate a browser/device workflow.
