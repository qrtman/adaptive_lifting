---
name: handsontable
description: Use when working with handsontable
---

# Handsontable Skill

Use when working with handsontable

## When to Use This Skill

Use this skill when you need to:
- understand handsontable features, APIs, and workflows
- find concrete code examples before implementing or debugging
- navigate the official documentation quickly through categorized references

## Quick Reference

### High-Signal Examples

**Example 1** (elixir):
```elixir
1/plugin marketplace add handsontable/handsontable-skills2/plugin install handsontable-skills@handsontable-skills
```

### Key Usage Notes

**Pattern 1:** Each position in the array corresponds to a visual (display) position, and the value at that position is the physical (source data) column index.

```
1manualColumnMove: [1, 0, 2]
```

**Pattern 2:** to override the tokens.gapSize, use the JS Option like this

```
1  myTheme.params({2    tokens: {3      gapSize: 'sizing.size_1'4    }5  })
```

**Pattern 3:** You can configure the theme before creating the instance using the builder pattern

```
1import { mainTheme, registerTheme } from 'handsontable/themes';2
3const theme = registerTheme(mainTheme)4  .setColorScheme('auto')   // 'light', 'dark', or 'auto'5  .setDensityType('comfortable');  // 'default', 'compact', or 'comfortable'6
7const hot = new Handsontable(container, {8  theme,9});
```

**Pattern 4:** Install Handsontable through your preferred package manager, or import Handsontable’s assets directly from a CDN.

```
1npm install handsontable
```

## Reference Files

This skill includes comprehensive documentation in `references/`:

- **api.md** - Api documentation
- **javascript-data-grid.md** - Javascript-Data-Grid documentation

Use `view` to read specific reference files when detailed information is needed.

## Working with This Skill

### Start Here
Start with the getting_started or tutorials reference files for foundational concepts.

### For Specific Features
Use the appropriate category reference file (api, guides, etc.) for detailed information.

### For Code Examples
Use the high-signal examples above first, then open the matching reference file for full context.

## Notes

- This skill was automatically generated from official documentation
- Reference files preserve the structure and examples from source docs
- Code examples include language detection for better syntax highlighting
- Quick reference entries are filtered to avoid low-signal placeholders and inline tokens

## Updating

To refresh this skill with updated documentation:
1. Re-run the scraper with the same configuration
2. The skill will be rebuilt with the latest information
