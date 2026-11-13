# Know Thy Wealth Identity

- Product name: **Know Thy Wealth**.
- Product line: **Your money, in view.**
- Repository and support: <https://github.com/zchhuang/big-money>.
- App mark: an open K, drawn from a steady upright and two outward arms. Use the authored SVG source for generated app icons.
- Icon palette: forest `#143c32`, mint `#daf2dc`; primary actions use `#235c49`
  with `#194b3b` hover; the in-app mark uses the current
  text/accent color to remain legible in every theme.

Use Know Thy Wealth in application titles, onboarding, settings, errors, install
metadata, native display names, release notifications, and new project docs.
Describe planned features as planned; the brand is not evidence of availability.

Actual Budget attribution belongs in credits, license notices, and explanations
of compatible upstream file formats. Preserve the MIT license and original
copyright notices. Historical upstream documentation and release history remain
reference material, not Know Thy Wealth marketing.

## Compatibility

The `@actual-app/*` workspace packages, `window.Actual` desktop bridge,
`X-Actual-*` network headers, `ACTUAL_*` configuration variables, SQLite schemas,
and existing budget paths retain their identifiers. Renaming those requires a
separate compatibility/migration change. Mobile bundle identifiers also remain
stable so existing installed mobile data is not silently orphaned.

Desktop distribution uses `com.knowthywealth.desktop` to distinguish the fork from
Actual installations. Existing budget folders retain their old names and can be
selected explicitly. Native store signing/publisher identities must be provided
by Know Thy Wealth's distributor; do not ship Actual's publisher certificate identity.

The app fetches this fork's release and news endpoints. New releases/news should
be published for Know Thy Wealth, independent of upstream Actual releases.

## Assets

`packages/component-library/src/icons/logo/logo.svg` is the in-app source;
`packages/desktop-client/public/brand-icon.svg` is the installed-app icon source.
Run `node bin/generate-brand-assets.mjs` to regenerate web/native raster assets.
Regenerate the React logo through the component library's SVG generator rather
than editing generated icon components by hand.
