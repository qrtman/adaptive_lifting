# Handsontable - Javascript-Data-Grid

**Pages:** 23

---

## Column moving | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/column-moving/

**Contents:**
- Column moving
- Enable the plugin
    - Move column headers
- Set a pre-defined column order
- Data model behavior
  - Don’t feed the snapshot back into the grid
- Control column moving
- Result
- Drag and move actions of the ManualColumnMove plugin
- Related API reference

There is a newer version of Handsontable available. Switch to the latest version →

Change the order of columns, either manually (dragging them to another location), or programmatically (using Handsontable’s API methods).

To enable column moving, set the manualColumnMove configuration option to true.

A draggable move handle appears above the selected column header. You can click and drag it to any location in the grid.

A column has to be selected before you can drag it. You can start the drag anywhere on the selected column’s header, including on the sorting label when column sorting is enabled. Handsontable tells a click from a drag by whether the pointer moves: press and release without moving to sort the column, and press and drag to move it.

When column sorting is enabled, only the header label and its sort indicator sort on click. Pressing the header around them selects the column without sorting it, so you can select a column and drag it in one gesture.

When you move columns, the default column headers (A, B, C) stay in place.

But, if you configure the colHeaders option with your own column labels (e.g., One, Two, Three), your headers move along with the columns.

Instead of setting manualColumnMove to true, you can pass an array of physical column indexes to define the initial visual order of columns on render.

Each position in the array corresponds to a visual (display) position, and the value at that position is the physical (source data) column index. For example:

This renders the columns in the following order:

The array must contain all physical column indexes (its length must equal the total number of columns). After the initial render, users can still drag columns to change the order further.

For more on how physical and visual indexes relate, see Understanding data and indexes.

Moving columns does not reorder your source data. Handsontable stores the new order as index metadata through its IndexMapper, and leaves the original data untouched. This affects how you read and save the data:

Sending the reordered snapshot back to the grid as its new data applies the move a second time. updateData() keeps the current column order on purpose, so Handsontable re-applies the order map it already holds on top of your already-reordered data. One drag then moves the column twice.

Treat the snapshot as output only. Send it to your backend, and leave the grid’s own data alone.

Use the beforeColumnMove hook to decide whether each column move is allowed. Returning false cancels the move while keeping the manualColumnMove plugin enabled.

Both beforeColumnMove and afterColumnMove run only when the pointer actually drags a column. A click on a column header does not fire them.

In the following example, select Allow column moving before you drag a column to a new position. Clear the checkbox to block column moving again.

After completing this guide, you can reorder columns by dragging them with the mouse or by calling dragColumns() and moveColumns() programmatically. You can also set a pre-defined column order at initialization or use beforeColumnMove to block individual moves.

There are significant differences between the plugin’s dragColumns and moveColumns API functions. Both of them change the order of columns, but they rely on different kinds of indexes. The differences between them are shown in the diagrams below.

Both of these methods trigger the beforeColumnMove and afterColumnMove hooks, but only dragColumns passes the dropIndex argument to them.

The dragColumns method has a dropIndex parameter, which points to where the elements are being dropped.

The moveColumns method has a finalIndex parameter, which points to where the elements will be placed after the moving action - finalIndex being the index of the first moved element.

The moveColumns function cannot perform some actions, e.g., more than one element can’t be moved to the last position. In this scenario, the move will be cancelled. The Plugin’s isMovePossible API method and the movePossible parameters beforeColumnMove and afterColumnMove hooks help in determine such situations.

Configuration options

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7// generate an array of arrays with dummy data8const data = new Array(200) // number of rows9  .fill(null)10  .map((_, row) =>11    new Array(20) // number of columns12      .fill(null)13      .map((_, column) => `${row}, ${column}`)14  );15
16const container = document.querySelector('#example1');17
18new Handsontable(container, {19  data,20  width: '100%',21  height: 320,22  rowHeaders: true,23  colHeaders: true,24  colWidths: 100,25  manualColumnMove: true,26  autoWrapRow: true,27  autoWrapCol: true,28  licenseKey: 'non-commercial-and-evaluation',29});
```

Example 2 (typescript):
```typescript
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7// generate an array of arrays with dummy data8const data: string[][] = new Array(200) // number of rows9  .fill(null)10  .map((_, row) =>11    new Array(20) // number of columns12      .fill(null)13      .map((_, column) => `${row}, ${column}`)14  );15
16const container = document.querySelector('#example1')!;17
18new Handsontable(container, {19  data,20  width: '100%',21  height: 320,22  rowHeaders: true,23  colHeaders: true,24  colWidths: 100,25  manualColumnMove: true,26  autoWrapRow: true,27  autoWrapCol: true,28  licenseKey: 'non-commercial-and-evaluation',29});
```

Example 3 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example2');8
9new Handsontable(container, {10  data: [11    ['A1', 'B1', 'C1'],12    ['A2', 'B2', 'C2'],13    ['A3', 'B3', 'C3'],14  ],15  colHeaders: true,16  rowHeaders: true,17  manualColumnMove: true,18  autoWrapRow: true,19  autoWrapCol: true,20  height: 'auto',21  licenseKey: 'non-commercial-and-evaluation',22});
```

Example 4 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example2')!;8
9new Handsontable(container, {10  data: [11    ['A1', 'B1', 'C1'],12    ['A2', 'B2', 'C2'],13    ['A3', 'B3', 'C3'],14  ],15  colHeaders: true,16  rowHeaders: true,17  manualColumnMove: true,18  autoWrapRow: true,19  autoWrapCol: true,20  height: 'auto',21  licenseKey: 'non-commercial-and-evaluation',22});
```

---

## Column widths | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/column-width/

**Contents:**
- Column widths
- Overview
- Set the column width as a constant
- Set the column width in an array
- Set the column width using a function
- Set a dynamic maximum column width
- Adjust the column width manually
- Column stretching
  - Fit all columns equally
  - Stretch only the last column

There is a newer version of Handsontable available. Switch to the latest version →

Configure column widths, using an array or a function. Let your users manually change column widths using Handsontable’s interface.

By default, the column width adjusts to the width of the content. However, if the width of the content is less than 50px, including 1px for borders on the sides, the column width remains constant at 50px. You can pass the column size as a constant, an array, or a function.

The content inside a cell will be wrapped if it doesn’t fit the cell’s width.

In this example we set the same width of 100px for all columns across the entire grid.

In this example, the width is only set for the first four columns. Each additional column would automatically adjust to the content.

In this example, the size of all columns is set using a function by taking a column index (1, 2 …) and multiplying it by 40px for each consecutive column.

Use the modifyColWidth hook to cap how wide a column can grow based on its content. The hook receives the width that Handsontable already calculated for the column. Return a smaller number to limit it. This pattern is middleware: you modify a value on its way through the width pipeline instead of setting a fixed size up front.

Unlike colWidths, a cap in modifyColWidth does not force every cell onto one width. Short values keep a narrow column on a single line. When content would exceed your threshold, the column shrinks to your cap and the text wraps.

Leave colWidths unset for columns you want to auto-size (or set the entry to undefined in an array). The AutoColumnSize plugin must stay enabled so Handsontable can measure content first. Setting colWidths as a single number disables auto-sizing for all columns.

You can also enforce a minimum width by returning Math.max(width, minWidth) from the same hook.

- Auto-sized columns never go below 50px. - stretchH runs after your hook and can widen columns beyond your cap. - When manualColumnResize is enabled, a width the user set by dragging overrides the hook for that column.

Set the option manualColumnResize to true to allow users to manually resize the column width by dragging the handle between the adjacent column headers. If you double-click on that handle, the width will be instantly adjusted to the size of the longest value in the column. Don’t forget to enable column headers by setting colHeaders to true.

You can adjust the size of one or multiple columns simultaneously, even if the selected columns are not placed next to each other.

When you set a column width programmatically with ManualColumnResize#setManualSize(), call hot.render() after the method call to repaint the grid. Values below 20px are stored as 20px.

You can adjust the width of the columns to make them fit the table’s width automatically. The width of a particular column will be calculated based on the size and number of other columns in the grid. This option only makes sense when you have at least one column in your data set and fewer columns than needed to enable the horizontal scrollbar.

Use the context menu to insert or remove columns. This will help you understand how the grid reacts to changes.

This example fits all columns to the container’s width equally by setting the option stretchH: 'all'.

In this example, the first three columns are set to be 80px wide, and the last column automatically fills the remaining space. This is achieved by setting the option stretchH: 'last'.

Column stretching interacts with manualColumnResize in two ways:

As mentioned above, the default width of the column is based on the widest value in any cell within the column. You may be wondering how it’s possible for data sets containing hundreds of thousands of records.

This feature is made possible thanks to the AutoColumnSize plugin, which is enabled by default. Internally it divides the data set into smaller sets and renders only some of them to measure their size. The size is then applied to the entire column based on the width of the widest found value.

To increase the performance, you can turn off this feature by defining the fixed size for the specified column or all columns.

If you call scrollViewportTo() and your columns have non-standard widths (for example, set by a custom renderer or CSS), make sure AutoColumnSize is enabled. Without it, the method may scroll to an incorrect position.

Setting the dimensions of the container that holds Handsontable is described in detail on the Grid size page.

Configuration options

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example1');8
9new Handsontable(container, {10  data: [11    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1', 'K1', 'L1', 'M1', 'N1', 'O1'],12    ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2', 'K2', 'L2', 'M2', 'N2', 'O2'],13    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3', 'K3', 'L3', 'M3', 'N3', 'O3'],14    ['A4', 'B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4', 'I4', 'J4', 'K4', 'L4', 'M4', 'N4', 'O4'],15    ['A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'G5', 'H5', 'I5', 'J5', 'K5', 'L5', 'M5', 'N5', 'O5'],16  ],17  width: '100%',18  height: 'auto',19  colHeaders: true,20  rowHeaders: true,21  colWidths: 100,22  manualColumnResize: true,23  autoWrapRow: true,24  autoWrapCol: true,25  licenseKey: 'non-commercial-and-evaluation',26});
```

Example 2 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example1')!;8
9new Handsontable(container, {10  data: [11    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1', 'K1', 'L1', 'M1', 'N1', 'O1'],12    ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2', 'K2', 'L2', 'M2', 'N2', 'O2'],13    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3', 'K3', 'L3', 'M3', 'N3', 'O3'],14    ['A4', 'B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4', 'I4', 'J4', 'K4', 'L4', 'M4', 'N4', 'O4'],15    ['A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'G5', 'H5', 'I5', 'J5', 'K5', 'L5', 'M5', 'N5', 'O5'],16  ],17  width: '100%',18  height: 'auto',19  colHeaders: true,20  rowHeaders: true,21  colWidths: 100,22  manualColumnResize: true,23  autoWrapRow: true,24  autoWrapCol: true,25  licenseKey: 'non-commercial-and-evaluation',26});
```

Example 3 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example2');8
9new Handsontable(container, {10  data: [11    ['A1', 'B1', 'C1', 'D1', 'E1'],12    ['A2', 'B2', 'C2', 'D2', 'E2'],13    ['A3', 'B3', 'C3', 'D3', 'E3'],14    ['A4', 'B4', 'C4', 'D4', 'E4'],15    ['A5', 'B5', 'C5', 'D5', 'E5'],16  ],17  width: '100%',18  height: 'auto',19  colHeaders: true,20  rowHeaders: true,21  colWidths: [50, 100, 200, 400],22  manualColumnResize: true,23  autoWrapRow: true,24  autoWrapCol: true,25  licenseKey: 'non-commercial-and-evaluation',26});
```

Example 4 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example2')!;8
9new Handsontable(container, {10  data: [11    ['A1', 'B1', 'C1', 'D1', 'E1'],12    ['A2', 'B2', 'C2', 'D2', 'E2'],13    ['A3', 'B3', 'C3', 'D3', 'E3'],14    ['A4', 'B4', 'C4', 'D4', 'E4'],15    ['A5', 'B5', 'C5', 'D5', 'E5'],16  ],17  width: '100%',18  height: 'auto',19  colHeaders: true,20  rowHeaders: true,21  colWidths: [50, 100, 200, 400],22  manualColumnResize: true,23  autoWrapRow: true,24  autoWrapCol: true,25  licenseKey: 'non-commercial-and-evaluation',26});
```

---

## Recipes | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/recipes/

**Contents:**
- Recipes
- Recipe categories

There is a newer version of Handsontable available. Switch to the latest version →

This is a collection of practical, production-ready recipes for common Handsontable development tasks. Each recipe provides step-by-step instructions, complete working code, and real-world use cases.

© 2012 – 2026 Handsoncode

---

## Skills for Claude Code | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/skills-for-claude-code/

**Contents:**
- Skills for Claude Code
- Two skills, one install
- Install with one command
- Versioned to match releases

There is a newer version of Handsontable available. Switch to the latest version →

Skills for Claude Code are bundled instructions that give Claude deep knowledge of Handsontable and HyperFormula. Install them once, then ask Claude to build, configure, or debug — it pulls from the same product docs you’re reading right now, so the code it writes matches current APIs instead of guessing from outdated training data.

The repo ships two skills:

Use handsontable when you’re building a visible grid in a web app. Use hyperformula when you’re evaluating formulas programmatically without a UI — server-side calculations, pricing engines, what-if analysis. Claude loads whichever is relevant based on what you ask.

In Claude Code, add the marketplace and install both skills:

For Cowork or Claude.ai web, download the zip from the latest GitHub release and drag it into chat. For the Claude API, upload the skill folder directly. Full instructions live in the repo README.

Each skill is tagged to the product version it targets — handsontable/v18.1.0 is the skill for Handsontable 18.1.0, and each HyperFormula release gets a matching hyperformula/v* tag. You always know which API surface Claude is working from.

Browse the Skills for Claude Code

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (elixir):
```elixir
1/plugin marketplace add handsontable/handsontable-skills2/plugin install handsontable-skills@handsontable-skills
```

---

## Column freezing | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/column-freezing/

**Contents:**
- Column freezing
- Overview
- Freeze columns at initialization
- User-triggered freeze
- Related API reference

There is a newer version of Handsontable available. Switch to the latest version →

Lock the position of specified columns, keeping them visible when scrolling.

Column freezing locks specific columns of a grid in place, keeping them visible while scrolling to another area of the grid. We refer to frozen columns as fixed.

You can freeze columns during initialization and by the user.

To freeze columns at initialization, use the fixedColumnsStart option. Then, configure the container of your grid with the following CSS attributes: width and overflow: hidden.

If your layout direction is ltr, columns get frozen from the left side of the table. If your layout direction is rtl, columns get frozen from the right side of the table.

To enable manual column freezing, set manualColumnFreeze to true. This lets you freeze and unfreeze columns by using the grid’s context menu.

Mind that when you unfreeze a frozen column, it doesn’t go back to the original position.

Configuration options

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7// generate an array of arrays with dummy data8const data = new Array(100) // number of rows9  .fill(null)10  .map((_, row) =>11    new Array(50) // number of columns12      .fill(null)13      .map((_, column) => `${row}, ${column}`)14  );15
16const container = document.querySelector('#example1');17
18new Handsontable(container, {19  data,20  colWidths: 100,21  width: '100%',22  height: 320,23  rowHeaders: true,24  colHeaders: true,25  fixedColumnsStart: 1,26  autoWrapRow: true,27  autoWrapCol: true,28  licenseKey: 'non-commercial-and-evaluation',29});
```

Example 2 (typescript):
```typescript
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7// generate an array of arrays with dummy data8const data: string[][] = new Array(100) // number of rows9  .fill(null)10  .map((_, row) =>11    new Array(50) // number of columns12      .fill(null)13      .map((_, column) => `${row}, ${column}`)14  );15
16const container = document.querySelector('#example1')!;17
18new Handsontable(container, {19  data,20  colWidths: 100,21  width: '100%',22  height: 320,23  rowHeaders: true,24  colHeaders: true,25  fixedColumnsStart: 1,26  autoWrapRow: true,27  autoWrapCol: true,28  licenseKey: 'non-commercial-and-evaluation',29});
```

Example 3 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7// generate an array of arrays with dummy data8const data = new Array(100) // number of rows9  .fill(null)10  .map((_, row) =>11    new Array(50) // number of columns12      .fill(null)13      .map((_, column) => `${row}, ${column}`)14  );15
16const container = document.querySelector('#example2');17
18new Handsontable(container, {19  data,20  colWidths: 100,21  width: '100%',22  height: 320,23  rowHeaders: true,24  colHeaders: true,25  fixedColumnsStart: 2,26  contextMenu: true,27  manualColumnFreeze: true,28  autoWrapRow: true,29  autoWrapCol: true,30  licenseKey: 'non-commercial-and-evaluation',31});
```

Example 4 (typescript):
```typescript
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7// generate an array of arrays with dummy data8const data: string[][] = new Array(100) // number of rows9  .fill(null)10  .map((_, row) =>11    new Array(50) // number of columns12      .fill(null)13      .map((_, column) => `${row}, ${column}`)14  );15
16const container = document.querySelector('#example2')!;17
18new Handsontable(container, {19  data,20  colWidths: 100,21  width: '100%',22  height: 320,23  rowHeaders: true,24  colHeaders: true,25  fixedColumnsStart: 2,26  contextMenu: true,27  manualColumnFreeze: true,28  autoWrapRow: true,29  autoWrapCol: true,30  licenseKey: 'non-commercial-and-evaluation',31});
```

---

## Adding and removing columns | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/column-adding/

**Contents:**
- Adding and removing columns
- Insert and remove columns with the API
- Add and remove columns from the context menu
- Add spare columns automatically
- Control and react to column changes
- Result
- Related API reference

There is a newer version of Handsontable available. Switch to the latest version →

Insert and remove columns programmatically with the alter() method, through the context menu, or automatically with spare columns.

Call the alter() method to change the column structure programmatically. Pass an action name, a column index, and the number of columns to insert or remove:

In the example below, Insert column appends a column to the right of the last column, and Remove last column removes the last column.

The index argument uses visual column indexes. The amount argument defaults to 1 when omitted.

Enable the contextMenu option to let users insert and remove columns by right-clicking a column. The relevant menu items are col_left (Insert column left), col_right (Insert column right), and remove_col (Remove column).

Setting contextMenu to true shows the full default menu. To show only the column actions, pass an array of item keys, as in the example below. Right-click a column header or cell to open the menu.

The allowInsertColumn and allowRemoveColumn options control whether these context menu items are available. Both default to true. Set allowInsertColumn to false to hide the insert items, or allowRemoveColumn to false to hide the remove item.

Set the minSpareCols option to keep a number of empty columns at the end of the grid. When a user enters data in the last empty column, Handsontable adds another empty column, so the grid always has at least the configured number of spare columns.

minSpareCols defaults to 0.

Use Handsontable’s hooks to validate or respond to column changes:

For example, block removing the last remaining column:

After completing this guide, you can insert and remove columns with the alter() method, let users add and remove columns through the context menu, keep spare columns at the end of the grid, and validate or react to column changes with hooks.

Configuration options

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3// register all Handsontable's modules4registerAllModules();5const container = document.querySelector('#example1');6const insertButton = document.querySelector('#insert-column');7const removeButton = document.querySelector('#remove-column');8const hot = new Handsontable(container, {9    data: [10        ['Ana García', 'Engineering', 'Senior Engineer', '2021-04-12'],11        ['James Okafor', 'Marketing', 'Product Manager', '2022-08-30'],12        ['Li Wei', 'Engineering', 'Staff Engineer', '2019-02-18'],13        ['Sofia Rossi', 'Sales', 'Account Executive', '2023-01-09'],14        ['Diego Fernández', 'Design', 'UX Designer', '2020-11-23'],15        ['Amara Singh', 'Engineering', 'Engineering Manager', '2018-06-05'],16    ],17    colHeaders: ['Name', 'Department', 'Title', 'Hire date'],18    rowHeaders: true,19    height: 'auto',20    autoWrapRow: true,21    autoWrapCol: true,22    licenseKey: 'non-commercial-and-evaluation',23});24insertButton.addEventListener('click', () => {25    // insert one column at the end of the grid26    hot.alter('insert_col_end', hot.countCols() - 1, 1);27});28removeButton.addEventListener('click', () => {29    // remove the last column, but keep at least one column in the grid30    if (hot.countCols() > 1) {31        hot.alter('remove_col', hot.countCols() - 1, 1);32    }33});
```

Example 2 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// register all Handsontable's modules5registerAllModules();6
7const container = document.querySelector('#example1')!;8const insertButton = document.querySelector('#insert-column')!;9const removeButton = document.querySelector('#remove-column')!;10
11const hot = new Handsontable(container, {12  data: [13    ['Ana García', 'Engineering', 'Senior Engineer', '2021-04-12'],14    ['James Okafor', 'Marketing', 'Product Manager', '2022-08-30'],15    ['Li Wei', 'Engineering', 'Staff Engineer', '2019-02-18'],16    ['Sofia Rossi', 'Sales', 'Account Executive', '2023-01-09'],17    ['Diego Fernández', 'Design', 'UX Designer', '2020-11-23'],18    ['Amara Singh', 'Engineering', 'Engineering Manager', '2018-06-05'],19  ],20  colHeaders: ['Name', 'Department', 'Title', 'Hire date'],21  rowHeaders: true,22  height: 'auto',23  autoWrapRow: true,24  autoWrapCol: true,25  licenseKey: 'non-commercial-and-evaluation',26});27
28insertButton.addEventListener('click', () => {29  // insert one column at the end of the grid30  hot.alter('insert_col_end', hot.countCols() - 1, 1);31});32
33removeButton.addEventListener('click', () => {34  // remove the last column, but keep at least one column in the grid35  if (hot.countCols() > 1) {36    hot.alter('remove_col', hot.countCols() - 1, 1);37  }38});
```

Example 3 (jsx):
```jsx
1<div class="example-controls-container">2  <div class="controls">3    <button id="insert-column" class="button button--primary">Insert column</button>4    <button id="remove-column" class="button button--primary">Remove last column</button>5  </div>6</div>7<div id="example1"></div>
```

Example 4 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3// register all Handsontable's modules4registerAllModules();5const container = document.querySelector('#example2');6new Handsontable(container, {7    data: [8        ['Ana García', 'Engineering', 'Senior Engineer', '2021-04-12'],9        ['James Okafor', 'Marketing', 'Product Manager', '2022-08-30'],10        ['Li Wei', 'Engineering', 'Staff Engineer', '2019-02-18'],11        ['Sofia Rossi', 'Sales', 'Account Executive', '2023-01-09'],12        ['Diego Fernández', 'Design', 'UX Designer', '2020-11-23'],13        ['Amara Singh', 'Engineering', 'Engineering Manager', '2018-06-05'],14    ],15    colHeaders: ['Name', 'Department', 'Title', 'Hire date'],16    rowHeaders: true,17    height: 'auto',18    // show only the column insert and remove items in the context menu19    contextMenu: ['col_left', 'col_right', 'remove_col'],20    autoWrapRow: true,21    autoWrapCol: true,22    licenseKey: 'non-commercial-and-evaluation',23});
```

---

## Demo | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/demo/

**Contents:**
- Demo
- Find the code on GitHub
- Try out the demo’s features
- Edit the demo’s source code
- What you learned
- Next steps

There is a newer version of Handsontable available. Switch to the latest version →

Explore Handsontable core features in this interactive demo. Click cells, sort columns, and use the context menu to see what the grid can do.

Explore the demo and discover Handsontable’s most popular features:

Just select your framework from the demo above.

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (javascript):
```javascript
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7// constants.js8export const data = [100 collapsed lines9  [false, 'Tagcat', 'United Kingdom', 'Classic Vest', '2025-10-11', '01-2331942', true, '172', 2, 2],10  [true, 'Zoomzone', 'Indonesia', 'Cycling Cap', '2025-05-03', '88-2768633', true, '188', 6, 2],11  [true, 'Meeveo', 'United States', 'Full-Finger Gloves', '2025-03-27', '51-6775945', true, '162', 1, 3],12  [false, 'Buzzdog', 'Philippines', 'HL Mountain Frame', '2025-08-29', '44-4028109', true, '133', 7, 1],13  [true, 'Katz', 'India', 'Half-Finger Gloves', '2025-10-02', '08-2758492', true, '87', 1, 3],14  [false, 'Jaxbean', 'China', 'HL Road Frame', '2025-09-28', '84-3557705', false, '26', 8, 1],15  [false, 'Wikido', 'Brazil', 'HL Touring Frame', '2025-06-24', '20-9397637', false, '110', 4, 1],16  [false, 'Browsedrive', 'United States', 'LL Mountain Frame', '2025-03-13', '36-0079556', true, '50', 4, 4],17  [false, 'Twinder', 'United Kingdom', 'LL Road Frame', '2025-04-06', '41-1489542', false, '160', 6, 1],18  [false, 'Jetwire', 'China', 'LL Touring Frame', '2025-02-01', '37-1531629', true, '30', 8, 5],19  [false, 'Chatterpoint', 'China', 'Long-Sleeve Logo Jersey', '2025-07-14', '25-5083429', true, '39', 7, 2],20  [false, 'Twinder', 'Egypt', "Men's Bib-Shorts", '2025-08-31', '04-4281278', false, '96', 6, 1],21  [false, 'Midel', 'United States', "Men's Sports Shorts", '2025-06-27', '55-1711908', true, '108', 10, 3],22  [false, 'Yodo', 'India', 'ML Mountain Frame', '2025-03-16', '58-8360815', false, '46', 1, 1],23  [false, 'Camido', 'Russia', 'ML Mountain Frame-W', '2025-09-13', '10-3786104', true, '97', 8, 3],24  [false, 'Eire', 'Thailand', 'ML Road Frame', '2025-04-10', '45-1186054', true, '161', 1, 4],25  [false, 'Vinte', 'United Kingdom', 'ML Road Frame-W', '2025-01-22', '62-6202742', true, '58', 4, 3],26  [false, 'Twitterlist', 'China', 'Mountain Bike Socks', '2025-11-09', '88-9646223', true, '92', 8, 3],27  [false, 'Eidel', 'Bangladesh', 'Mountain-100', '2025-09-19', '45-5588112', true, '5', 6, 5],28  [false, 'Trunyx', 'Nigeria', 'Mountain-200', '2025-03-09', '66-6271819', true, '158', 4, 1],29  [false, 'Katz', 'Turkey', 'Mountain-300', '2025-03-05', '38-9245023', false, '121', 5, 4],30  [false, 'Kaymbo', 'United States', 'Mountain-400-W', '2025-12-24', '44-5916927', false, '61', 5, 4],31  [false, 'Ozu', 'Pakistan', 'Mountain-500', '2025-06-13', '31-5449914', true, '155', 2, 2],32  [false, 'Rhynyx', 'India', 'Racing Socks', '2025-12-05', '19-9413869', true, '162', 2, 4],33  [false, 'Flashset', 'Iran', 'Road-150', '2025-12-14', '25-9807605', false, '46', 7, 1],34  [false, 'Yata', 'Congo (Kinshasa)', 'Road-250', '2025-06-12', '74-4291983', true, '47', 4, 4],35  [false, 'Brainlounge', 'Vietnam', 'Road-350-W', '2025-03-10', '83-0980643', true, '104', 2, 3],36  [false, 'Babblestorm', 'United States', 'Road-450', '2025-10-10', '19-2878430', true, '101', 6, 4],37  [false, 'Youspan', 'Brazil', 'Road-550-W', '2025-12-16', '19-1838230', true, '150', 10, 3],38  [false, 'Nlounge', 'China', 'Road-650', '2025-10-31', '32-2267938', true, '42', 4, 2],39  [false, 'Twinte', 'India', 'Road-750', '2025-08-17', '79-2821972', true, '144', 9, 3],40  [false, 'Oyonder', 'United Kingdom', 'Short-Sleeve Classic Jersey', '2025-12-04', '46-6597557', true, '195', 4, 1],41  [false, 'Gigabox', 'Pakistan', 'Sport-100', '2025-02-03', '15-1793960', true, '199', 4, 4],42  [false, 'Livetube', 'France', 'Touring-1000', '2025-05-16', '86-0811003', true, '110', 4, 5],43  [false, 'Voomm', 'United Kingdom', 'Touring-2000', '2025-07-15', '95-3068680', true, '51', 4, 4],44  [false, 'Voonyx', 'China', 'Touring-3000', '2025-11-27', '35-3085360', false, '69', 2, 5],45  [false, 'Zoombeat', 'United States', "Women's Mountain Shorts", '2025-11-03', '56-8673088', false, '53', 2, 3],46  [false, 'Roomm', 'China', "Women's Tights", '2025-03-16', '76-0085918', true, '168', 1, 1],47  [false, 'Leenti', 'China', 'Mountain-400', '2025-05-16', '03-0893276', false, '58', 1, 4],48  [false, 'Jetpulse', 'United States', 'Road-550', '2025-02-08', '79-9013306', true, '152', 9, 3],49  [false, 'Katz', 'Peru', 'Road-350', '2025-02-15', '55-7799920', true, '66', 4, 2],50  [false, 'Cogidoo', 'India', 'LL Mountain Front Wheel', '2025-06-04', '07-0881122', false, '112', 9, 2],51  [false, 'Divavu', 'Colombia', 'Touring Rear Wheel', '2025-02-24', '58-6157387', true, '50', 10, 4],52  [false, 'Mydeo', 'China', 'Touring Front Wheel', '2025-12-07', '12-2810010', false, '31', 3, 5],53  [false, 'Browsebug', 'Japan', 'ML Mountain Front Wheel', '2025-01-14', '64-9249984', true, '132', 5, 5],54  [false, 'Layo', 'China', 'HL Mountain Front Wheel', '2025-04-24', '45-0739652', true, '45', 1, 5],55  [false, 'Snaptags', 'United Kingdom', 'LL Touring Handlebars', '2025-08-06', '09-5712761', true, '197', 4, 2],56  [false, 'Cogilith', 'China', 'HL Touring Handlebars', '2025-05-31', '01-7345008', true, '190', 4, 3],57  [false, 'Reallinks', 'United Kingdom', 'LL Road Front Wheel', '2025-05-14', '62-1065350', true, '184', 3, 4],58  [false, 'Quaxo', 'United States', 'ML Road Front Wheel', '2025-03-23', '44-7241323', true, '169', 3, 4],59  [false, 'Devify', 'China', 'HL Road Front Wheel', '2025-12-12', '52-0295699', false, '152', 4, 4],60  [false, 'Youopia', 'Angola', 'LL Mountain Handlebars', '2025-04-01', '52-2650922', false, '182', 6, 4],61  [false, 'Ainyx', 'China', 'Touring Pedal', '2025-02-27', '48-3618525', true, '141', 6, 1],62  [false, 'Browsetype', 'Malaysia', 'ML Mountain Handlebars', '2025-04-28', '51-8893923', true, '169', 7, 1],63  [false, 'Muxo', 'China', 'HL Mountain Handlebars', '2025-08-22', '68-5911361', false, '39', 7, 1],64  [false, 'Bubbletube', 'China', 'LL Road Handlebars', '2025-10-04', '41-5880042', true, '71', 8, 3],65  [false, 'Fadeo', 'Vietnam', 'ML Road Handlebars', '2025-04-23', '90-5913983', true, '148', 10, 3],66  [false, 'Yadel', 'United Kingdom', 'HL Road Handlebars', '2025-04-18', '92-0960699', true, '116', 8, 1],67  [false, 'Blognation', 'China', 'LL Headset', '2025-01-10', '06-9493898', true, '96', 10, 1],68  [false, 'Devpoint', 'China', 'ML Headset', '2025-12-25', '69-5878565', true, '35', 4, 2],69  [false, 'Aibox', 'United Kingdom', 'HL Headset', '2025-03-18', '13-1133017', true, '16', 8, 2],70  [false, 'Brightdog', 'China', 'LL Mountain Pedal', '2025-09-11', '39-6530433', true, '194', 2, 5],71  [false, 'Gabcube', 'Nigeria', 'ML Mountain Pedal', '2025-04-22', '96-6860388', true, '24', 1, 3],72  [false, 'Muxo', 'China', 'HL Mountain Pedal', '2025-06-05', '30-0356137', true, '170', 4, 4],73  [false, 'Tambee', 'China', 'ML Touring Seat/Saddle', '2025-02-22', '93-9058255', true, '184', 9, 5],74  [false, 'Cogilith', 'India', 'LL Touring Seat/Saddle', '2025-04-06', '82-9268909', false, '153', 10, 4],75  [false, 'Dynabox', 'Hong Kong', 'HL Touring Seat/Saddle', '2025-01-10', '20-6913815', false, '88', 10, 1],76  [false, 'Shuffledrive', 'Sudan', 'LL Road Pedal', '2025-09-16', '08-8238817', true, '57', 9, 2],77  [false, 'Fivechat', 'China', 'ML Road Pedal', '2025-08-26', '44-7370350', false, '62', 4, 1],78  [false, 'Meembee', 'United States', 'HL Road Pedal', '2025-12-27', '01-3525949', true, '123', 2, 4],79  [false, 'Dynazzy', 'United Kingdom', 'LL Mountain Seat/Saddle 1', '2025-12-15', '04-2414623', true, '77', 10, 5],80  [false, 'Eare', 'China', 'ML Mountain Seat/Saddle 1', '2025-04-04', '15-1917509', false, '199', 9, 4],81  [false, 'Yozio', 'China', 'HL Mountain Seat/Saddle 1', '2025-03-15', '06-2526845', true, '149', 8, 2],82  [false, 'Quinu', "Xi'an", '425-777-7829', '2025-02-22', '83-1713558', false, '191', 9, 5],83  [false, 'Jazzy', 'United Kingdom', 'ML Road Seat/Saddle 1', '2025-08-07', '00-8892524', true, '150', 10, 2],84  [false, 'Thoughtsphere', 'China', 'HL Road Seat/Saddle 1', '2025-11-28', '39-5538991', true, '130', 7, 3],85  [false, 'Leenti', 'China', 'ML Road Rear Wheel', '2025-12-29', '06-9002973', true, '179', 1, 2],86  [false, 'Quaxo', 'United Kingdom', 'HL Road Rear Wheel', '2025-09-06', '73-6104901', true, '98', 5, 3],87  [false, 'Tanoodle', 'Chile', 'LL Mountain Seat/Saddle 2', '2025-05-24', '68-7384479', true, '175', 2, 3],88  [false, 'Feednation', 'China', 'ML Mountain Seat/Saddle 2', '2025-11-21', '26-7757763', true, '11', 1, 3],89  [false, 'Kayveo', 'China', 'HL Mountain Seat/Saddle 2', '2025-06-21', '07-4873562', false, '184', 7, 4],90  [false, 'Meevee', 'Saudi Arabia', 'LL Road Seat/Saddle 1', '2025-11-16', '46-5819554', false, '27', 9, 3],91  [false, 'Twitterworks', 'China', 'ML Road Seat/Saddle 2', '2025-04-19', '01-2666826', true, '186', 3, 2],92  [false, 'Wikizz', 'Tanzania', 'HL Road Seat/Saddle 2', '2025-03-08', '54-7090503', true, '20', 3, 3],93  [false, 'Yoveo', 'United States', 'LL Mountain Tire', '2025-10-14', '78-7658520', false, '153', 2, 1],94  [false, 'Yakidoo', 'China', 'ML Mountain Tire', '2025-10-12', '23-9926318', true, '161', 8, 5],95  [false, 'Oyope', 'China', 'HL Mountain Tire', '2025-09-20', '20-0179517', true, '98', 10, 5],96  [false, 'Skipstorm', 'United States', 'LL Road Tire', '2025-10-01', '02-9543343', true, '30', 7, 3],97  [false, 'Minyx', 'United States', 'ML Road Tire', '2025-07-07', '98-3938169', true, '73', 10, 2],98  [false, 'Miboo', 'China', 'HL Road Tire', '2025-07-25', '68-5197934', true, '158', 9, 1],99  [false, 'Realfire', 'United States', 'Touring Tire', '2025-08-27', '39-8260460', true, '122', 5, 2],100  [false, 'Shufflester', 'China', 'Mountain Tire Tube', '2025-06-08', '45-9776170', true, '33', 2, 4],101  [false, 'Ntag', 'China', 'Road Tire Tube', '2025-12-06', '45-0858451', true, '107', 6, 2],102  [false, 'Jabberbean', 'United States', 'Touring Tire Tube', '2025-04-26', '15-4247305', true, '15', 1, 2],103  [false, 'Thoughtblab', 'China', 'LL Bottom Bracket', '2025-05-21', '15-8534931', true, '168', 5, 2],104  [false, 'Jabbertype', 'China', 'Classic Vest', '2025-07-25', '23-1251557', true, '135', 4, 2],105  [false, 'Buzzshare', 'United Kingdom', 'Cycling Cap', '2025-07-07', '86-5920601', true, '11', 1, 4],106  [false, 'Roodel', 'United States', 'Full-Finger Gloves', '2025-01-13', '48-1055459', true, '41', 6, 4],107  [false, 'Zoovu', 'China', 'Half-Finger Gloves', '2025-06-03', '12-7842022', true, '144', 6, 1],108  [false, 'Photofeed', 'China', 'HL Mountain Frame', '2025-07-14', '94-5088099', true, '106', 1, 4],109];110export const SELECTED_CLASS = 'selected';111
112export function addClassesToRows(TD, row, column, _prop, _value, cellProperties) {113  // Adding classes to `TR` just while rendering first visible `TD` element114  if (column !== 0) {115    return;116  }117
118  const parentElement = TD.parentElement;119
120  if (parentElement === null) {121    return;122  }123
124  // Add class to selected rows125  if (cellProperties.instance.getDataAtRowProp(row, '0')) {126    parentElement.classList.add(SELECTED_CLASS);127  } else {128    parentElement.classList.remove(SELECTED_CLASS);129  }130}131
132const example = document.getElementById('example');133
134new Handsontable(example, {135  data,136  height: 450,137  width: '100%',138  colWidths: [180, 220, 140, 120, 120, 120, 140],139  colHeaders: ['Company Name', 'Name', 'Sell date', 'In stock', 'Quantity', 'Order ID', 'Country'],140  contextMenu: [141    'cut',142    'copy',143    '---------',144    'row_above',145    'row_below',146    'remove_row',147    '---------',148    'alignment',149    'make_read_only',150    'clear_column',151  ],152  columns: [153    { data: 1, type: 'text' },154    { data: 3, type: 'text' },155    {156      data: 4,157      type: 'intl-date',158      locale: 'en-GB',159      dateFormat: { day: '2-digit', month: '2-digit', year: 'numeric' },160    },161    {162      data: 6,163      type: 'checkbox',164      className: 'htCenter',165    },166    { data: 7, type: 'numeric' },167    { data: 5, type: 'text' },168    { data: 2, type: 'text' },169  ],170  dropdownMenu: true,171  hiddenColumns: {172    indicators: true,173  },174  multiColumnSorting: true,175  filters: true,176  rowHeaders: true,177  manualRowMove: true,178  headerClassName: 'htLeft',179  beforeRenderer: addClassesToRows,180  autoWrapRow: true,181  autoWrapCol: true,182  autoRowSize: true,183  manualRowResize: true,184  manualColumnResize: true,185  navigableHeaders: true,186  imeFastEdit: true,187  licenseKey: 'non-commercial-and-evaluation',188});189console.log(`Handsontable: v${Handsontable.version} (${Handsontable.buildDate})`);
```

---

## Changes between versions | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/changes-between-versions/

**Contents:**
- Changes between versions

There is a newer version of Handsontable available. Switch to the latest version →

Compare two Handsontable versions. Pick a From and To release to see the breaking changes, deprecations, new APIs, and fixes between them.

© 2012 – 2026 Handsoncode

---

## Introduction | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/

**Contents:**
- Introduction
- Getting started 🚀
- Examples
- What can I use Handsontable for?
- Types of software
- Join our Community 🙌
- Technical support
- Stay in the loop
- Related

There is a newer version of Handsontable available. Switch to the latest version →

Handsontable is a JavaScript data grid component. This page explains what it does, who uses it, and when it is the right tool for your project.

Use Handsontable with plain JavaScript, TypeScript, or your favorite framework. This guide will walk you through the basics, from installation to creating your first data grid.

Examples with SSR (Server Side Rendering):

Think of Handsontable as an extensible framework that empowers you to quickly build tabular, data-oriented user interfaces tailored to your specific needs. With Handsontable, developers can efficiently tackle real-life problems by leveraging its flexibility and customization options.

Discover more about how Handsontable is used in different industries by visiting our Successful Customers page.

Handsontable’s built-in features make it a perfect fit for applications across different types of software.

You are welcome to join our GitHub community. Discuss new releases, propose features, and report bugs on:

Implementing Handsontable requires a certain level of front-end development skills. If you need help and your support plan is active, contact our technical support or report an issue on GitHub

© 2012 – 2026 Handsoncode

---

## Column headers | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/column-header/

**Contents:**
- Column headers
- Overview
- Default headers
- Header labels as an array
- Header labels as a function
- Header labels in the columns option
- Customize column headers
- Column header height
- Nested headers
- Related articles

There is a newer version of Handsontable available. Switch to the latest version →

Use default column headers (A, B, C), or set them to custom values provided by an array or a function.

Column headers are gray-colored rows used to label each column or group of columns. By default, these headers are populated with letters in alphabetical order.

To reflect the type or category of data in a particular column, give it a custom name and then display it in a column header. For example, instead of letters as labels such as A, B, C, ... name them ID, Full name, Country, ....

Setting the colHeaders option to true enables the default column headers as shown in the example below:

An array of labels can be used to set the colHeaders as shown in the example below:

The colHeaders can also be populated using a function as shown in the example below:

When you configure columns individually with the columns option, set a column’s header label with that column’s title option. If both are set, a column’s title takes precedence over the matching colHeaders entry.

You can align the text in the header label with the headerClassName option. Setting it to htLeft, htCenter, or htRight will align the header labels to the left, center, or right, respectively.

You can also set the alignment for a specific column by using the columns option.

If you want to style the header labels, you can pass any number of class names, separated by a space, to the headerClassName option.

When column labels are longer, header text can wrap and require more vertical space. To control the header size, set columnHeaderHeight.

You can set this option to one of the following:

The example below uses longer labels together with columnHeaderHeight: 50.

More complex data structures can be displayed with multiple headers, each representing a different category of data. To learn more about nested headers, see the column groups page.

Related blog articles

Configuration options

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example1');8
9new Handsontable(container, {10  data: [11    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1', 'K1'],12    ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2', 'K2'],13    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3', 'K3'],14  ],15  colHeaders: true,16  rowHeaders: true,17  height: 'auto',18  autoWrapRow: true,19  autoWrapCol: true,20  licenseKey: 'non-commercial-and-evaluation',21});
```

Example 2 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example1')!;8
9new Handsontable(container, {10  data: [11    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1', 'K1'],12    ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2', 'K2'],13    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3', 'K3'],14  ],15  colHeaders: true,16  rowHeaders: true,17  height: 'auto',18  autoWrapRow: true,19  autoWrapCol: true,20  licenseKey: 'non-commercial-and-evaluation',21});
```

Example 3 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example2');8
9new Handsontable(container, {10  data: [11    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1'],12    ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2'],13    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3'],14  ],15  colHeaders: ['ID', 'Full name', 'Position', 'Country', 'City', 'Address', 'Zip code', 'Mobile', 'E-mail'],16  rowHeaders: true,17  height: 'auto',18  autoWrapRow: true,19  autoWrapCol: true,20  licenseKey: 'non-commercial-and-evaluation',21});
```

Example 4 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example2')!;8
9new Handsontable(container, {10  data: [11    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1'],12    ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2'],13    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3'],14  ],15  colHeaders: ['ID', 'Full name', 'Position', 'Country', 'City', 'Address', 'Zip code', 'Mobile', 'E-mail'],16  rowHeaders: true,17  height: 'auto',18  autoWrapRow: true,19  autoWrapCol: true,20  licenseKey: 'non-commercial-and-evaluation',21});
```

---

## AI Theme Builder | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/ai-theme-builder/

**Contents:**
- AI Theme Builder
- AI theme generation
- Multi-framework support
- Test in StackBlitz

There is a newer version of Handsontable available. Switch to the latest version →

The Theme Builder is a free web tool for building Handsontable themes visually, instead of writing code. You can manually adjust over 200 design tokens with UI controls and see the table update in real-time. Then you can export the theme and use it in your own app!

To go deeper on the underlying theme system, see the Themes and Theme customization guides.

Click the AI tab on the right to generate themes from a prompt. Describe the look you want — for example, “minimal light theme with rounded headers” or “dark theme with high-contrast borders” — and the builder generates the theme configuration file.

You can ask for follow up changes, or switch over to the manual editor to make any final adjustments before exporting.

The Theme Builder generates working configurations for vanilla JavaScript, React, and Angular. So it’s easy to use the generated theme in your own framework.

Click the Generate code button, then choose your framework, and copy the theme.

Try out your theme in a live web application by clicking the Open in StackBlitz button. This opens a new tab in StackBlitz where you can test and edit the theme in the web instead of downloading the files to run locally.

Open the Theme Builder

© 2012 – 2026 Handsoncode

---

## Grid size | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/grid-size/

**Contents:**
- Grid size
- Set your grid’s size
  - Define the size in your CSS
  - Pass the size in the configuration
  - Compare size units
  - Use 'auto' sizing
  - Troubleshooting with 100% height
- What if the size is not set
- Stretch columns to fit the grid width
- Autoresizing

There is a newer version of Handsontable available. Switch to the latest version →

Set the width and height of the grid, using either absolute values or values relative to the parent container.

You need to define the grid’s container as a starting point to initialize it. Usually, the div element becomes this container. This container should have defined dimensions as well as the rest of your layout. Handsontable supports relative units such as %, rem, em, vh, vw, and px.

Both width and height could be defined as inline styles or as a CSS class property. In this case, it’s important to define what should be an overflow parent properly. Handsontable looks for the closest element with overflow: auto or overflow: hidden to use it as a scrollable container. If no such element is found, a window will be used.

Handsontable doesn't observe CSS changes for containers out of the box. If you'd like to observe it, you can define the dimensions in the configuration object or create your own observer.

You can pass width and height values to Handsontable as numbers or possible CSS values for the “width”/“height” properties:

You can also pass a function to width and height. Use this when you calculate dimensions from your current layout. The function can return a number (pixels) or a CSS size string.

These dimensions will be set as inline styles in a container element, and overflow: hidden will be added automatically.

If container is a block element, then its parent has to have defined height. By default block element is 0px height, so 100% from 0px is still 0px.

Changes called in updateSettings() will re-render the grid with the new properties.

Use the dropdown in the demo below to switch the grid’s width and height between px, %, em, rem, vh, and vw, and see how the same grid responds to each unit.

Set height: 'auto' to make the grid grow to match its content height. Handsontable writes height: auto; overflow: clip; as inline styles on the root element. No internal vertical scrollbar is created, so the page itself scrolls when the grid is taller than the viewport.

You can combine it with width: 'auto' to let the grid follow its parent container’s width:

height: 'auto' is different from leaving height unset:

With height: 'auto', every row is laid out in the DOM at once. Avoid this value for large datasets. Set a numeric height instead so that Handsontable can virtualize off-screen rows.

When the height option is set to 100%, there are three ways to define the container’s height. Assuming you’re creating an Handsontable instance that has 100% height and container is element with id #example.

When using Flexbox, the container automatically expands to fill the available space in the flex container. This is particularly useful when you want the grid to take up all the available space within its parent.

If you don’t define any dimensions, Handsontable generates as many rows and columns as needed to fill the available space.

If your grid’s contents don’t fit in the viewport, the browser’s native scrollbars are used for scrolling. For this to work properly, Handsontable’s layout direction (e.g., layoutDirection: 'rtl') must be the same as your HTML document’s layout direction (<html dir='rtl'>). Otherwise, horizontal scrolling doesn’t work.

Setting the grid’s width doesn’t change the width of your columns. When the columns are narrower than the grid, the space on the right stays empty. To redistribute the column widths so they fill the grid’s width, use the stretchH option: 'all' stretches all columns proportionally, and 'last' stretches only the last column.

For live examples of both modes, see the column stretching section of the Column width guide.

Handsontable observes window resizing. If the window’s dimensions have changed, then we check if Handsontable should resize itself too. Due to the performance issue, we use the debounce method to respond on window resize.

You can easily overwrite this behaviour by returning false in the beforeRefreshDimensions hook.

The Handsontable instance exposes the refreshDimensions() method, which helps you to resize grid elements properly.

You can listen for two hooks, beforeRefreshDimensions and afterRefreshDimensions.

Handsontable relies on the browser’s native scrollbars. Browsers cap how tall (or wide) a scrollable area can be, measured in CSS pixels. The taller the scroll area grows past that cap, the more rendering glitches appear - rows become misaligned, the autofill handle turns blurry, and eventually cell borders disappear.

The point where these glitches start depends on the browser, the operating system, and the device. The following approximate values were measured on macOS, and mark where problems begin rather than a hard cutoff:

These values are approximate, were measured on specific browser versions, and can change as browsers update.

To estimate the maximum number of rows, divide the browser’s pixel limit by your row height. With the default row height of 23 px, Chrome stays reliable up to about 350,000 rows (8,000,000 / 23). To estimate the maximum number of columns, divide the pixel limit by your column width. With a column width of 50 px, that’s about 160,000 columns (8,000,000 / 50).

Taller rows or wider columns lower these limits proportionally. For example, with a row height of 100 px, Chrome’s limit drops to about 80,000 rows (8,000,000 / 100).

If your dataset can grow past these limits, load it in smaller chunks, for example with server-side or lazy data loading.

Your grid now renders at the dimensions you specified, responding to container size or fixed pixel values as configured.

Configuration options

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (unknown):
```unknown
1{2  width: '100px',3  height: '100px',4}
```

Example 2 (unknown):
```unknown
1{2  width: '75%',3  height: '75%',4}
```

Example 3 (json):
```json
1{2  width: 100,3  height: 100,4}
```

Example 4 (bash):
```bash
1{2  width() {3    return `${window.innerWidth - 64}px`;4  },5  height() {6    return 400;7  },8}
```

---

## Column summary | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/column-summary/

**Contents:**
- Column summary
- Overview
  - Column summary example
  - Built-in summary functions
  - Column summary options
- Set up a column summary
  - Enable the ColumnSummary plugin
  - Select cells that you want to summarize
  - Calculate your summary
  - Provide the destination cell’s coordinates

There is a newer version of Handsontable available. Switch to the latest version →

Calculate sum, min, max, count, average or custom aggregates of individual columns’ data, using Handsontable’s aggregate functions.

The ColumnSummary plugin lets you quickly calculate and display a column summary.

Handsontable’s aggregates are column-based: ColumnSummary summarizes a range of rows within a column. There is no separate row summary (rowSummary) feature. To show a per-row total across columns, compute it in your data source or a custom renderer.

To customize your column summaries, you can:

This example calculates and displays five different column summaries:

To decide how a column summary is calculated, you can use one of the following summary functions:

You can customize each of your column summaries with configuration options.

For the full list of available options, see the API reference.

To set up a column summary, follow the steps below.

To enable the ColumnSummary plugin, set the columnSummary configuration option to an array of objects. Each object represents a single column summary.

You can also set the columnSummary option to a function.

By default, a column summary takes all cells of the column in which it displays its result (see the destinationColumn option in step 4).

To summarize any other column, use the sourceColumn option:

You can also summarize individual ranges of rows (rather than a whole column). To do this, set the ranges option to an array of arrays, where each array represents a single row range.

Now, decide how you want to calculate your column summary.

To display your column summary result in a cell, provide the destination cell’s coordinates.

Set the destinationRow and destinationColumn options to the physical coordinates of your required cell.

Don't change the className metadata of the summary row.

If you need to style the summary row, use the class name assigned automatically by the ColumnSummary plugin: columnSummaryResult.

The ColumnSummary plugin doesn’t automatically add new rows to display its summary results.

So, if you always want to display your column summary result below your existing rows, you need to:

To reverse row coordinates for your column summary, set the reversedRowCoords option to true, and adjust the destinationRow coordinate.

Instead of setting up the column summary options manually, you can provide the whole column summary configuration as a function that returns a required array of objects.

The example below sets up five different column summaries. To do this, it:

Using a function to provide a column summary configuration lets you set up all sorts of more complex column summaries. For example, you can sum subtotals for nested groups:

Apart from using the built-in summary functions, you can also implement your own custom function that performs any summary calculation you want.

To implement a custom summary function:

This example implements a function that counts the number of even values in a column:

You can round a column summary result to a specific number of digits after the decimal point.

To enable this feature, set the roundFloat option to your preferred number of digits between 0 and 100. See the following example:

The roundFloat option accepts the following values:

If you enable roundFloat, the data type returned by Handsontable’s data-retrieving methods (like getDataAtCell()) changes from number to string.

To summarize a column that contains non-numeric data, you can:

You can force your column summary to treat non-numeric values as numeric values.

The forceNumeric option uses JavaScript's parseFloat() function.

This means that e.g., 3c is treated as 3, but c3 is still treated as c3.

To enable this feature, set the forceNumeric option to true (by default, forceNumeric is set to false). For example:

You can throw a data type error whenever a non-numeric value is passed to your column summary.

To throw data type errors, set the suppressDataTypeErrors option to false (by default, suppressDataTypeErrors is set to true). For example:

After completing this guide, your grid calculates and displays column aggregates using built-in or custom summary functions. You can target specific cell ranges, control rounding, and handle non-numeric values.

Configuration options

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example1');8
9new Handsontable(container, {10  licenseKey: 'non-commercial-and-evaluation',11  data: [[1, 2, 3, 4, 5], [6, 7, 8, 9, 12.345], [11, 12, 13, null, 15], [null]],12  colHeaders: ['sum', 'min', 'max', 'count', 'average'],13  rowHeaders: true,14  // enable and configure the `ColumnSummary` plugin15  columnSummary: [16    {17      sourceColumn: 0,18      type: 'sum',19      destinationRow: 3,20      destinationColumn: 0,21      forceNumeric: true,22    },23    {24      sourceColumn: 1,25      type: 'min',26      destinationRow: 3,27      destinationColumn: 1,28      forceNumeric: true,29    },30    {31      sourceColumn: 2,32      type: 'max',33      destinationRow: 3,34      destinationColumn: 2,35      forceNumeric: true,36    },37    {38      sourceColumn: 3,39      type: 'count',40      destinationRow: 3,41      destinationColumn: 3,42      forceNumeric: true,43    },44    {45      sourceColumn: 4,46      type: 'average',47      roundFloat: 'auto',48      destinationRow: 3,49      destinationColumn: 4,50      forceNumeric: true,51    },52  ],53  autoWrapRow: true,54  autoWrapCol: true,55  height: 'auto',56});
```

Example 2 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example1')!;8
9new Handsontable(container, {10  licenseKey: 'non-commercial-and-evaluation',11  data: [[1, 2, 3, 4, 5], [6, 7, 8, 9, 12.345], [11, 12, 13, null, 15], [null]],12  colHeaders: ['sum', 'min', 'max', 'count', 'average'],13  rowHeaders: true,14  // enable and configure the `ColumnSummary` plugin15  columnSummary: [16    {17      sourceColumn: 0,18      type: 'sum',19      destinationRow: 3,20      destinationColumn: 0,21      forceNumeric: true,22    },23    {24      sourceColumn: 1,25      type: 'min',26      destinationRow: 3,27      destinationColumn: 1,28      forceNumeric: true,29    },30    {31      sourceColumn: 2,32      type: 'max',33      destinationRow: 3,34      destinationColumn: 2,35      forceNumeric: true,36    },37    {38      sourceColumn: 3,39      type: 'count',40      destinationRow: 3,41      destinationColumn: 3,42      forceNumeric: true,43    },44    {45      sourceColumn: 4,46      type: 'average',47      roundFloat: 'auto',48      destinationRow: 3,49      destinationColumn: 4,50      forceNumeric: true,51    },52  ],53  autoWrapRow: true,54  autoWrapCol: true,55  height: 'auto',56});
```

Example 3 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const hot = new Handsontable(document.querySelector('#example'), {8  licenseKey: 'non-commercial-and-evaluation',9  data: [10    [1, 2, 3, 4, 5],11    [6, 7, 8, 9, 10],12    [11, 12, 13, 14, 15]13  ],14  colHeaders: true,15  rowHeaders: true,16  // set the `columnSummary` configuration option to an array of17  // objects18  columnSummary: [19    {},20    {}21  ],22});
```

Example 4 (yaml):
```yaml
1columnSummary: [2  {3    // set this column summary to summarize the first column4    // (i.e. a column with physical index `0`)5    sourceColumn: 0,6  },7  {8    // set this column summary to summarize the second column9    // (i.e. a column with physical index `1`)10    sourceColumn: 1,11  }12]
```

---

## Theme customization | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/theme-customization/

**Contents:**
- Theme customization
- Overview
- Option 1: Theme API
  - Register a custom theme
  - Configure theme parameters
  - Theme API example
- Option 2: Figma Theme Generator
  - Export themes from Figma
- Option 3: Override CSS variables
  - Target the theme class, not the container

There is a newer version of Handsontable available. Switch to the latest version →

Customize Handsontable’s appearance using the Theme API, Figma Theme Generator, CSS variables, or the visual Theme Builder.

CSS variables provide a powerful and flexible way to customize Handsontable’s appearance by adjusting design elements such as colors, spacing, borders, and typography to match your application’s design system. These variables give you granular control over every visual aspect of the data grid, from basic styling to advanced component customization.

We provide multiple approaches for leveraging CSS variables to create any look that your designer can imagine. From quick theme modifications to completely custom designs, your options include:

The data grid’s styling system is built entirely on CSS variables, with over 200 variables organized into logical categories covering typography, colors, spacing, borders, and component-specific styling listed below.

The Theme API allows you to customize themes programmatically by registering custom themes and configuring them at runtime. You can use the theme option with a ThemeBuilder object for dynamic configuration.

Use registerTheme to create a custom theme with your own configuration:

Use the params() method to update theme parameters dynamically:

The following example demonstrates using the Theme API to register a theme with a custom purple accent color:

The Figma Theme Generator allows designers and developers to work together seamlessly by exporting design tokens directly from Figma into a CSS theme file.

To create a new theme or modify an existing one in Figma:

The Theme Generator transforms JSON tokens exported from Figma into properly formatted theme files that work with Handsontable. It outputs CSS files (with or without icons) and JS variable files for colors, tokens, and icons. This approach is ideal for teams where designers define the visual language in Figma and developers implement it in code.

For full control over your theme, you can override CSS variables directly. Follow these steps to apply a theme, then override the variables for your chosen theme.

You can also open the CSS theme files in handsontable/styles/ to see every CSS variable a theme defines. Copy the variables you need into your own stylesheet - edits made inside node_modules are lost on the next install.

Here’s an example for .ht-theme-main:

Set your overrides on the theme class. Handsontable renders an inner wrapper that also carries the theme class, and that wrapper redefines every variable the theme owns. A value you set on the container element is inherited by the wrapper and then overwritten there, so it never reaches the cells:

Raising the specificity of that selector does not help, because the wrapper’s own declaration is closer to the cells rather than weaker.

Scope your rule to the theme class instead. Writing it as a descendant of your container keeps the override local to one grid and independent of stylesheet order:

A bare .ht-theme-main { ... } rule works as well, but it matches the wrapper with the same specificity as the theme’s own rule. It wins only when your stylesheet comes after the theme stylesheet, which depends on how your bundler orders CSS.

If you prefer a visual approach to creating themes, use the Handsontable Theme Builder. This online tool provides an intuitive interface for customizing colors, spacing, and other theme properties without writing code. Once you’re satisfied with your design, you can export the generated your theme and integrate it into your project.

Handsontable provides a comprehensive set of JS and CSS variables that let you customize the appearance of every component.

CSS Variable — The names of the CSS custom properties (e.g. --ht-sizing-size-1) you can override in your stylesheet.

JS Option — The values in this column are the keys you use when customizing a theme via the Theme API. Call theme.params() on your registered theme and pass an object where each key is nested under one of:

Example: to override the tokens.gapSize, use the JS Option like this:

These variables style the handles shown at each edge midpoint of a selected range when the selectionHandles option is on. They are separate from the mobile touch handles above.

These variables style the Notification plugin toasts. Shared layout tokens (for example borderRadius, tableTransition, gapSize) and icon-button tokens still apply to the close control and spacing.

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (sql):
```sql
1import Handsontable from 'handsontable';2
3import { mainTheme, registerTheme } from 'handsontable/themes';4
5// Register main theme6const myTheme = registerTheme(mainTheme);7
8// Configure the theme at runtime9myTheme.setColorScheme('light'); // 'light', 'dark', or 'auto'10myTheme.setDensityType('default'); // 'compact', 'default', or 'comfortable'11
12const hot = new Handsontable(container, {13  theme: myTheme,14  // other options15});
```

Example 2 (json):
```json
1myTheme.params({2  colors: {3    primary: {4      500: '#9333ea', // Change primary color5    },6  },7  tokens: {8    fontSize: '16px',9    iconSize: 'sizing.size_5',10    borderColor: ['colors.primary.500', 'colors.primary.600'],11  },12});
```

Example 3 (julia):
```julia
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3import { horizonTheme, registerTheme } from 'handsontable/themes';4
5// Register all Handsontable's modules.6registerAllModules();7
8// Register the main theme with custom parameters9const myTheme = registerTheme(horizonTheme);10
11// Configure theme parameters using the params() method12myTheme.params({13  colors: {14    primary: {15      500: '#9333ea', // Change primary color16    },17  },18  tokens: {19    fontSize: '16px',20    iconSize: 'sizing.size_5',21    accentColor: ['colors.primary.500', 'colors.primary.600'],22  },23});24// Set color scheme and density type25myTheme.setColorScheme('light');26myTheme.setDensityType('default');27
28const container = document.querySelector('#example2');29
30new Handsontable(container, {31  theme: myTheme,32  data: [33    ['John Doe', 'johndoe@example.com', 'New York', 32, 'Engineer'],34    ['Jane Smith', 'janesmith@example.com', 'Los Angeles', 29, 'Designer'],35    ['Sam Wilson', 'samwilson@example.com', 'Chicago', 41, 'Manager'],36    ['Emily Johnson', 'emilyj@example.com', 'San Francisco', 35, 'Developer'],37    ['Michael Brown', 'mbrown@example.com', 'Boston', 38, 'Analyst'],38  ],39  colHeaders: ['Name', 'Email', 'City', 'Age', 'Position'],40  columns: [41    { data: 0, type: 'text' },42    { data: 1, type: 'text' },43    { data: 2, type: 'text' },44    { data: 3, type: 'numeric' },45    { data: 4, type: 'text' },46  ],47  rowHeaders: true,48  dropdownMenu: true,49  width: '100%',50  height: 'auto',51  licenseKey: 'non-commercial-and-evaluation',52});
```

Example 4 (julia):
```julia
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3import { horizonTheme, registerTheme } from 'handsontable/themes';4
5// Register all Handsontable's modules.6registerAllModules();7
8// Register the main theme with custom parameters9const myTheme = registerTheme(horizonTheme);10
11// Configure theme parameters using the params() method12myTheme.params({13  colors: {14    primary: {15      500: '#9333ea', // Change primary color16    },17  },18  tokens: {19    fontSize: '16px',20    iconSize: 'sizing.size_5',21    accentColor: ['colors.primary.500', 'colors.primary.600'],22  },23});24
25// Set color scheme and density type26myTheme.setColorScheme('light');27myTheme.setDensityType('default');28
29const container = document.querySelector('#example2')!;30
31new Handsontable(container, {32  theme: myTheme,33  data: [34    ['John Doe', 'johndoe@example.com', 'New York', 32, 'Engineer'],35    ['Jane Smith', 'janesmith@example.com', 'Los Angeles', 29, 'Designer'],36    ['Sam Wilson', 'samwilson@example.com', 'Chicago', 41, 'Manager'],37    ['Emily Johnson', 'emilyj@example.com', 'San Francisco', 35, 'Developer'],38    ['Michael Brown', 'mbrown@example.com', 'Boston', 38, 'Analyst'],39  ],40  colHeaders: ['Name', 'Email', 'City', 'Age', 'Position'],41  columns: [42    { data: 0, type: 'text' },43    { data: 1, type: 'text' },44    { data: 2, type: 'text' },45    { data: 3, type: 'numeric' },46    { data: 4, type: 'text' },47  ],48  rowHeaders: true,49  dropdownMenu: true,50  width: '100%',51  height: 'auto',52  licenseKey: 'non-commercial-and-evaluation',53});
```

---

## AI Docs Assistant | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/ai-docs-assistant/

**Contents:**
- AI Docs Assistant
- International language support
- Current page context

There is a newer version of Handsontable available. Switch to the latest version →

The AI Docs Assistant is the Ask AI button in the docs header. It answers questions about Handsontable and HyperFormula, writes code examples, and links you to the relevant guide or API reference page.

I search the docs to answer questions about APIs, configuration, and usage. I say “I don’t know” when the docs don’t cover it.

The main search bar (Cmd + K) searches using keyword matches, but the Docs Assistant uses semantic search to match on concepts and related topics. Use the Docs Assistant when you want to chat about a topic or see code examples generated. Click the Ask AI button in the header to get started.

Ask your question in any language and the assistant will reply accordingly, while keeping API methods, function names, and other key terms in English to ensure valid code generation.

Ask questions about the current page without copy/pasting the contents. The Docs Assistant knows what page you’re on, and you can even switch pages and continue the conversation.

© 2012 – 2026 Handsoncode

---

## Configuration options | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/configuration-options/

**Contents:**
- Configuration options
- Overview
  - Cascading configuration
  - Plugin options
- Set grid options
  - Example
- Set column options
  - Example
- Set row options
  - Example

There is a newer version of Handsontable available. Switch to the latest version →

Configure your grid down to each column, row, and cell, using various built-in options that control Handsontable’s behavior and user interface.

To apply configuration options, pass them as a second argument of the Handsontable constructor, using the object literal notation:

Depending on your needs, you can apply configuration options to different elements of your grid, such as:

For the full list of available configuration options, see the configuration options’ API reference.

Handsontable’s configuration cascades down:

When you modify the mid-level column options (using the columns option):

When you modify the bottom-level cell options (using the cell option):

When you modify any options with the cells function, the changes overwrite all other options.

Unless an option’s reference entry states otherwise, you can set it at any cascading level - the grid level, the columns level, the cells level, and the cell level. An option marked as grid-level only has no effect when you set it per column or per cell.

The cells option is a function invoked before Handsontable's rendering cycle. Implemented incorrectly, it can slow Handsontable down. Use the cells option only if the cell option, the columns option, and the setCellMeta() method don't meet your needs.

For more details on Handsontable’s cascading configuration, see the MetaManager class.

To read configuration at runtime, use the method that matches the level you need:

Configuration options come from:

If you use Handsontable through modules: to use an option that comes from a Handsontable plugin, you need to import and register that plugin when initializing your Handsontable instance.

To find out if an option comes from a plugin, check the Category label in the configuration options’ API reference.

To apply configuration options to the entire grid, pass your options as a second argument of the Handsontable constructor, using the object literal notation.

For example, to set the entire grid’s width and height:

To configure each cell in the grid as read-only, apply the readOnly option as a top-level grid option.

The top-level grid options cascade down:

As a result, each cell in the grid is read-only:

To apply configuration options to an individual column (or a range of columns), use the columns option.

In the example below, the columns option is set to a function.

The function applies the readOnly: true option to each column that has a physical index of either 2 or 8.

The modified mid-level column options:

As a result, each cell in the third and ninth columns is read-only:

To apply configuration options to an individual row (or a range of rows), use the cells option.

Any options modified through cells overwrite all other options.

The function can take three arguments:

Inside the cells function, this is the cell meta object, and this.instance is the Handsontable instance. Use this.instance to call core API methods — for example, this.instance.toVisualRow(row).

In the example below, the cells option sets each cell in the first and fourth row as readOnly.

Options modified through cells overwrite all other options.

To apply configuration options to individual cells, use the cell option.

Each entry’s row and col are visual indexes (unlike the cells option, whose row and column are physical indexes).

In the example below, the cell option sets cell A1(0, 0) and cell B2(1, 1) as readOnly.

The modified cell options:

When Handsontable is running, you can check a cell’s current options, using the getCellMeta() method.

The getCellMeta() method returns an object with:

When Handsontable is running, you can change the initial cell options, using the setCellMeta() method.

setCellMeta() updates a cell’s metadata but doesn’t repaint the grid on its own. To make a visual change appear — such as a new className, type, or readOnly state — call render() afterward. If you change several cells at once, wrap the calls in batch() so the grid renders only once.

You can apply configuration options to individual grid elements (columns, rows, cells), based on any logic you implement, using the cells option.

The cells option overwrites all other options.

The function can take three arguments:

Inside the cells function, this is the cell meta object, and this.instance is the Handsontable instance. Use this.instance to call core API methods — for example, this.instance.toVisualRow(row).

In the example below, the modified cells options overwrite the top-level grid options.

In the example below, some cells are read-only, and some cells are editable:

Your grid now applies configuration options at the scope you specified — grid-wide, per column, per row, or per individual cell — using Handsontable’s cascading configuration system.

Configuration options

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (scala):
```scala
1import Handsontable from "handsontable";2
3const container = document.querySelector('#example');4const hot = new Handsontable(container, {5  // configuration options, in the object literal notation6  licenseKey: "non-commercial-and-evaluation",7  data: [8    ['A1', 'B1', 'C1', 'D1'],9    ['A2', 'B2', 'C2', 'D2'],10    ['A3', 'B3', 'C3', 'D3'],11  ],12  width: 400,13  height: 300,14  colHeaders: true,15  rowHeaders: true,16  customBorders: true,17  dropdownMenu: true,18  multiColumnSorting: true,19  filters: true,20  manualRowMove: true,21});
```

Example 2 (json):
```json
1const hot = new Handsontable(container, {2  // top-level grid options that apply to the entire grid3  width: 400,4  height: 3005});
```

Example 3 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example1');8const data = [9  ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1'],10  ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2'],11  ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3'],12  ['A4', 'B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4', 'I4', 'J4'],13  ['A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'G5', 'H5', 'I5', 'J5'],14];15
16const hot = new Handsontable(container, {17  licenseKey: 'non-commercial-and-evaluation',18  data,19  readOnly: true,20  width: 'auto',21  height: 'auto',22  rowHeaders: true,23  colHeaders: true,24  autoWrapRow: true,25  autoWrapCol: true,26});27
28// checks a cell's options29// returns `true`30hot.getCellMeta(0, 0).readOnly;
```

Example 4 (html):
```html
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector<HTMLDivElement>('#example1')!;8
9const data: Handsontable.CellValue[][] = [10  ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1'],11  ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2'],12  ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3'],13  ['A4', 'B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4', 'I4', 'J4'],14  ['A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'G5', 'H5', 'I5', 'J5'],15];16
17const hot = new Handsontable(container, {18  licenseKey: 'non-commercial-and-evaluation',19  data,20  readOnly: true,21  width: 'auto',22  height: 'auto',23  rowHeaders: true,24  colHeaders: true,25  autoWrapRow: true,26  autoWrapCol: true,27});28
29// checks a cell's options30// returns `true`31hot.getCellMeta(0, 0).readOnly;
```

---

## Themes | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/themes/

**Contents:**
- Themes
- Overview
- Built-in themes
- Light and dark modes
- Use a theme
  - Option 1: Using the Theme API (recommended)
    - Import a theme
    - Configure the theme
  - Option 2: Using CSS files
    - Load CSS files

There is a newer version of Handsontable available. Switch to the latest version →

Use Handsontable’s built-in themes or customize its look using the Theme API or CSS variables.

Handsontable themes manage most visual elements of the data grid. Three built-in themes are available: main, horizon, and classic. All themes include dark and light modes.

The recommended way to apply themes is using the Theme API, which allows you to register and configure themes programmatically with runtime features like density modes and color schemes. Alternatively, you can use CSS files and pass the theme name as a string for a simpler setup.

The main theme offers a spreadsheet-like interface, perfect for batch-editing tasks and providing users with a familiar experience, similar to other popular spreadsheet software on the market.

The horizon theme, on the other hand, is better suited for data display and analysis. It hides the vertical lines between columns, giving it a cleaner and more lightweight feel.

The classic theme is a replacement for the old legacy style. It retains the familiar look and feel of the original legacy styles, but has been updated to allow customization with CSS variables. This theme is ideal for users who prefer the traditional appearance of Handsontable but want to benefit from the theming system. The classic theme supports both light and dark modes, ensuring a seamless integration with your application’s color scheme preferences.

Keep in mind that starting from version 15.0, importing a theme is required.

If you want to use the main theme without any modifications, you don't need to configure anything. Handsontable will automatically use the main theme with default settings.

Each theme comes with three modes:

When using the Theme API, you can configure the color scheme using setColorScheme() with 'light', 'dark', or 'auto' values. The 'auto' option allows programmatic control over light/dark switching based on your application’s logic.

When using CSS files, color scheme switching is controlled through CSS class names. Use ht-theme-{name} for light mode, ht-theme-{name}-dark for dark mode, or ht-theme-{name}-dark-auto for automatic switching based on system preferences (e.g., ht-theme-main, ht-theme-main-dark, ht-theme-main-dark-auto).

If you don’t want to declare a theme at all, set the colorScheme option instead. See Set the color scheme or density without a theme.

There are two ways to apply a theme. The recommended approach is to use the Theme API with a theme object, which provides full access to runtime configuration features like density modes and color schemes.

The Theme API allows you to import and register themes programmatically. This approach provides runtime access to theme customization features.

You can configure the theme before creating the instance using the builder pattern:

Or configure it after init by retrieving the registered theme with getTheme() (the theme is registered when you pass it to the config):

UMD build (script tags)

When using Handsontable via CDN or script tags, load the theme script after the main Handsontable script. The theme auto-registers itself, and you can retrieve it using getTheme():

Alternatively, you can load theme CSS files and pass the theme name as a string to the theme option.

To ensure Handsontable renders correctly, it’s required to load both the base and theme CSS files. The base file contains structural styles, while the theme file includes colors, sizes, and other variables needed for the grid.

Alternatively, you can import the necessary files from the recommended CDN such as JSDelivr or cdnjs.

To use a theme, specify the theme name in the data grid’s global settings object:

If the only thing you want to change is the color scheme or the amount of white space, you don’t have to import, register, and configure a theme. Set the colorScheme or density option directly, and the grid applies it on top of the theme it already uses.

Both options are per-instance overrides. The theme itself stays unchanged, so other grids that use the same theme keep their own color scheme and density.

Pass either option to updateSettings(). This is all you need for a dark mode toggle:

An unsupported value is ignored, and the grid logs a warning naming the option. It does not throw, so one bad value does not break the rest of the update.

To drop an override and go back to the value your theme defines, set the option to undefined:

Both options are features of the Theme API, so they need the theme engine to be active. The engine is active when you leave the theme option out, or when you pass a theme config object or a ThemeBuilder instance to it. It is not active when the theme comes from a CSS class name — either the theme option set to a string such as 'ht-theme-main', or an ht-theme-* class on the container element. In that case the grid logs a warning and the options have no effect.

Apart from that, it doesn’t matter which stylesheets you load. Both options work with the base stylesheet alone and with a theme stylesheet on top of it, minified or not.

When registering a theme with registerTheme() or updating it using the params() method, you can configure the following keys:

Token values support a powerful reference system using dot notation. Instead of hardcoding values, you can reference values from other configuration namespaces:

The sizing scale provides consistent spacing values:

Colors use a hierarchical structure with dot notation for nested values:

Density values adjust spacing based on the selected density type:

Tokens can reference other tokens for consistent styling:

For tokens that should have different values in light and dark modes, use an array with two values where the first value is for light mode and the second is for dark mode:

Handsontable provides CSS files needed to style your data grid. Here’s an overview of what’s available:

All themes are available in two variants:

If you’re using a theme without icons (*-no-icons.css), you can optionally load separate icon files:

For production, use the minified versions (.min.css) to reduce file size and improve load times. For development, you may prefer the unminified versions (.css) for easier debugging.

The legacy CSS file (handsontable.full.min.css) was the default styles up until version 15 (released in December 2024). These styles are legacy and are removed in version 17.0.0.

In some cases, global styles enforced by the browser or operating system can impact the appearance of the data grid. This is a common challenge faced by all websites, not just Handsontable. Here are two specific scenarios and how to handle them:

Your grid now renders with the theme you configured. You can switch color schemes and density modes at runtime using the Theme API.

Didn’t find what you need? Try this:

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (sql):
```sql
1import Handsontable from 'handsontable';2import { mainTheme, horizonTheme, classicTheme, registerTheme, getTheme } from 'handsontable/themes';3
4registerTheme(mainTheme);5registerTheme(horizonTheme);6registerTheme(classicTheme);7
8// constants.js102 collapsed lines9export const data = [10  [false, 'Tagcat', 'United Kingdom', 'Classic Vest', '2025-10-11', '01-2331942', true, '172', 2, 2],11  [true, 'Zoomzone', 'Indonesia', 'Cycling Cap', '2025-05-03', '88-2768633', true, '188', 6, 2],12  [true, 'Meeveo', 'United States', 'Full-Finger Gloves', '2025-03-27', '51-6775945', true, '162', 1, 3],13  [false, 'Buzzdog', 'Philippines', 'HL Mountain Frame', '2025-08-29', '44-4028109', true, '133', 7, 1],14  [true, 'Katz', 'India', 'Half-Finger Gloves', '2025-10-02', '08-2758492', true, '87', 1, 3],15  [false, 'Jaxbean', 'China', 'HL Road Frame', '2025-09-28', '84-3557705', false, '26', 8, 1],16  [false, 'Wikido', 'Brazil', 'HL Touring Frame', '2025-06-24', '20-9397637', false, '110', 4, 1],17  [false, 'Browsedrive', 'United States', 'LL Mountain Frame', '2025-03-13', '36-0079556', true, '50', 4, 4],18  [false, 'Twinder', 'United Kingdom', 'LL Road Frame', '2025-04-06', '41-1489542', false, '160', 6, 1],19  [false, 'Jetwire', 'China', 'LL Touring Frame', '2025-02-01', '37-1531629', true, '30', 8, 5],20  [false, 'Chatterpoint', 'China', 'Long-Sleeve Logo Jersey', '2025-07-14', '25-5083429', true, '39', 7, 2],21  [false, 'Twinder', 'Egypt', "Men's Bib-Shorts", '2025-08-31', '04-4281278', false, '96', 6, 1],22  [false, 'Midel', 'United States', "Men's Sports Shorts", '2025-06-27', '55-1711908', true, '108', 10, 3],23  [false, 'Yodo', 'India', 'ML Mountain Frame', '2025-03-16', '58-8360815', false, '46', 1, 1],24  [false, 'Camido', 'Russia', 'ML Mountain Frame-W', '2025-09-13', '10-3786104', true, '97', 8, 3],25  [false, 'Eire', 'Thailand', 'ML Road Frame', '2025-04-10', '45-1186054', true, '161', 1, 4],26  [false, 'Vinte', 'United Kingdom', 'ML Road Frame-W', '2025-01-22', '62-6202742', true, '58', 4, 3],27  [false, 'Twitterlist', 'China', 'Mountain Bike Socks', '2025-11-09', '88-9646223', true, '92', 8, 3],28  [false, 'Eidel', 'Bangladesh', 'Mountain-100', '2025-09-19', '45-5588112', true, '5', 6, 5],29  [false, 'Trunyx', 'Nigeria', 'Mountain-200', '2025-03-09', '66-6271819', true, '158', 4, 1],30  [false, 'Katz', 'Turkey', 'Mountain-300', '2025-03-05', '38-9245023', false, '121', 5, 4],31  [false, 'Kaymbo', 'United States', 'Mountain-400-W', '2025-12-24', '44-5916927', false, '61', 5, 4],32  [false, 'Ozu', 'Pakistan', 'Mountain-500', '2025-06-13', '31-5449914', true, '155', 2, 2],33  [false, 'Rhynyx', 'India', 'Racing Socks', '2025-12-05', '19-9413869', true, '162', 2, 4],34  [false, 'Flashset', 'Iran', 'Road-150', '2025-12-14', '25-9807605', false, '46', 7, 1],35  [false, 'Yata', 'Congo (Kinshasa)', 'Road-250', '2025-06-12', '74-4291983', true, '47', 4, 4],36  [false, 'Brainlounge', 'Vietnam', 'Road-350-W', '2025-03-10', '83-0980643', true, '104', 2, 3],37  [false, 'Babblestorm', 'United States', 'Road-450', '2025-10-10', '19-2878430', true, '101', 6, 4],38  [false, 'Youspan', 'Brazil', 'Road-550-W', '2025-12-16', '19-1838230', true, '150', 10, 3],39  [false, 'Nlounge', 'China', 'Road-650', '2025-10-31', '32-2267938', true, '42', 4, 2],40  [false, 'Twinte', 'India', 'Road-750', '2025-08-17', '79-2821972', true, '144', 9, 3],41  [false, 'Oyonder', 'United Kingdom', 'Short-Sleeve Classic Jersey', '2025-12-04', '46-6597557', true, '195', 4, 1],42  [false, 'Gigabox', 'Pakistan', 'Sport-100', '2025-02-03', '15-1793960', true, '199', 4, 4],43  [false, 'Livetube', 'France', 'Touring-1000', '2025-05-16', '86-0811003', true, '110', 4, 5],44  [false, 'Voomm', 'United Kingdom', 'Touring-2000', '2025-07-15', '95-3068680', true, '51', 4, 4],45  [false, 'Voonyx', 'China', 'Touring-3000', '2025-11-27', '35-3085360', false, '69', 2, 5],46  [false, 'Zoombeat', 'United States', "Women's Mountain Shorts", '2025-11-03', '56-8673088', false, '53', 2, 3],47  [false, 'Roomm', 'China', "Women's Tights", '2025-03-16', '76-0085918', true, '168', 1, 1],48  [false, 'Leenti', 'China', 'Mountain-400', '2025-05-16', '03-0893276', false, '58', 1, 4],49  [false, 'Jetpulse', 'United States', 'Road-550', '2025-02-08', '79-9013306', true, '152', 9, 3],50  [false, 'Katz', 'Peru', 'Road-350', '2025-02-15', '55-7799920', true, '66', 4, 2],51  [false, 'Cogidoo', 'India', 'LL Mountain Front Wheel', '2025-06-04', '07-0881122', false, '112', 9, 2],52  [false, 'Divavu', 'Colombia', 'Touring Rear Wheel', '2025-02-24', '58-6157387', true, '50', 10, 4],53  [false, 'Mydeo', 'China', 'Touring Front Wheel', '2025-12-07', '12-2810010', false, '31', 3, 5],54  [false, 'Browsebug', 'Japan', 'ML Mountain Front Wheel', '2025-01-14', '64-9249984', true, '132', 5, 5],55  [false, 'Layo', 'China', 'HL Mountain Front Wheel', '2025-04-24', '45-0739652', true, '45', 1, 5],56  [false, 'Snaptags', 'United Kingdom', 'LL Touring Handlebars', '2025-08-06', '09-5712761', true, '197', 4, 2],57  [false, 'Cogilith', 'China', 'HL Touring Handlebars', '2025-05-31', '01-7345008', true, '190', 4, 3],58  [false, 'Reallinks', 'United Kingdom', 'LL Road Front Wheel', '2025-05-14', '62-1065350', true, '184', 3, 4],59  [false, 'Quaxo', 'United States', 'ML Road Front Wheel', '2025-03-23', '44-7241323', true, '169', 3, 4],60  [false, 'Devify', 'China', 'HL Road Front Wheel', '2025-12-12', '52-0295699', false, '152', 4, 4],61  [false, 'Youopia', 'Angola', 'LL Mountain Handlebars', '2025-04-01', '52-2650922', false, '182', 6, 4],62  [false, 'Ainyx', 'China', 'Touring Pedal', '2025-02-27', '48-3618525', true, '141', 6, 1],63  [false, 'Browsetype', 'Malaysia', 'ML Mountain Handlebars', '2025-04-28', '51-8893923', true, '169', 7, 1],64  [false, 'Muxo', 'China', 'HL Mountain Handlebars', '2025-08-22', '68-5911361', false, '39', 7, 1],65  [false, 'Bubbletube', 'China', 'LL Road Handlebars', '2025-10-04', '41-5880042', true, '71', 8, 3],66  [false, 'Fadeo', 'Vietnam', 'ML Road Handlebars', '2025-04-23', '90-5913983', true, '148', 10, 3],67  [false, 'Yadel', 'United Kingdom', 'HL Road Handlebars', '2025-04-18', '92-0960699', true, '116', 8, 1],68  [false, 'Blognation', 'China', 'LL Headset', '2025-01-10', '06-9493898', true, '96', 10, 1],69  [false, 'Devpoint', 'China', 'ML Headset', '2025-12-25', '69-5878565', true, '35', 4, 2],70  [false, 'Aibox', 'United Kingdom', 'HL Headset', '2025-03-18', '13-1133017', true, '16', 8, 2],71  [false, 'Brightdog', 'China', 'LL Mountain Pedal', '2025-09-11', '39-6530433', true, '194', 2, 5],72  [false, 'Gabcube', 'Nigeria', 'ML Mountain Pedal', '2025-04-22', '96-6860388', true, '24', 1, 3],73  [false, 'Muxo', 'China', 'HL Mountain Pedal', '2025-06-05', '30-0356137', true, '170', 4, 4],74  [false, 'Tambee', 'China', 'ML Touring Seat/Saddle', '2025-02-22', '93-9058255', true, '184', 9, 5],75  [false, 'Cogilith', 'India', 'LL Touring Seat/Saddle', '2025-04-06', '82-9268909', false, '153', 10, 4],76  [false, 'Dynabox', 'Hong Kong', 'HL Touring Seat/Saddle', '2025-01-10', '20-6913815', false, '88', 10, 1],77  [false, 'Shuffledrive', 'Sudan', 'LL Road Pedal', '2025-09-16', '08-8238817', true, '57', 9, 2],78  [false, 'Fivechat', 'China', 'ML Road Pedal', '2025-08-26', '44-7370350', false, '62', 4, 1],79  [false, 'Meembee', 'United States', 'HL Road Pedal', '2025-12-27', '01-3525949', true, '123', 2, 4],80  [false, 'Dynazzy', 'United Kingdom', 'LL Mountain Seat/Saddle 1', '2025-12-15', '04-2414623', true, '77', 10, 5],81  [false, 'Eare', 'China', 'ML Mountain Seat/Saddle 1', '2025-04-04', '15-1917509', false, '199', 9, 4],82  [false, 'Yozio', 'China', 'HL Mountain Seat/Saddle 1', '2025-03-15', '06-2526845', true, '149', 8, 2],83  [false, 'Quinu', "Xi'an", '425-777-7829', '2025-02-22', '83-1713558', false, '191', 9, 5],84  [false, 'Jazzy', 'United Kingdom', 'ML Road Seat/Saddle 1', '2025-08-07', '00-8892524', true, '150', 10, 2],85  [false, 'Thoughtsphere', 'China', 'HL Road Seat/Saddle 1', '2025-11-28', '39-5538991', true, '130', 7, 3],86  [false, 'Leenti', 'China', 'ML Road Rear Wheel', '2025-12-29', '06-9002973', true, '179', 1, 2],87  [false, 'Quaxo', 'United Kingdom', 'HL Road Rear Wheel', '2025-09-06', '73-6104901', true, '98', 5, 3],88  [false, 'Tanoodle', 'Chile', 'LL Mountain Seat/Saddle 2', '2025-05-24', '68-7384479', true, '175', 2, 3],89  [false, 'Feednation', 'China', 'ML Mountain Seat/Saddle 2', '2025-11-21', '26-7757763', true, '11', 1, 3],90  [false, 'Kayveo', 'China', 'HL Mountain Seat/Saddle 2', '2025-06-21', '07-4873562', false, '184', 7, 4],91  [false, 'Meevee', 'Saudi Arabia', 'LL Road Seat/Saddle 1', '2025-11-16', '46-5819554', false, '27', 9, 3],92  [false, 'Twitterworks', 'China', 'ML Road Seat/Saddle 2', '2025-04-19', '01-2666826', true, '186', 3, 2],93  [false, 'Wikizz', 'Tanzania', 'HL Road Seat/Saddle 2', '2025-03-08', '54-7090503', true, '20', 3, 3],94  [false, 'Yoveo', 'United States', 'LL Mountain Tire', '2025-10-14', '78-7658520', false, '153', 2, 1],95  [false, 'Yakidoo', 'China', 'ML Mountain Tire', '2025-10-12', '23-9926318', true, '161', 8, 5],96  [false, 'Oyope', 'China', 'HL Mountain Tire', '2025-09-20', '20-0179517', true, '98', 10, 5],97  [false, 'Skipstorm', 'United States', 'LL Road Tire', '2025-10-01', '02-9543343', true, '30', 7, 3],98  [false, 'Minyx', 'United States', 'ML Road Tire', '2025-07-07', '98-3938169', true, '73', 10, 2],99  [false, 'Miboo', 'China', 'HL Road Tire', '2025-07-25', '68-5197934', true, '158', 9, 1],100  [false, 'Realfire', 'United States', 'Touring Tire', '2025-08-27', '39-8260460', true, '122', 5, 2],101  [false, 'Shufflester', 'China', 'Mountain Tire Tube', '2025-06-08', '45-9776170', true, '33', 2, 4],102  [false, 'Ntag', 'China', 'Road Tire Tube', '2025-12-06', '45-0858451', true, '107', 6, 2],103  [false, 'Jabberbean', 'United States', 'Touring Tire Tube', '2025-04-26', '15-4247305', true, '15', 1, 2],104  [false, 'Thoughtblab', 'China', 'LL Bottom Bracket', '2025-05-21', '15-8534931', true, '168', 5, 2],105  [false, 'Jabbertype', 'China', 'Classic Vest', '2025-07-25', '23-1251557', true, '135', 4, 2],106  [false, 'Buzzshare', 'United Kingdom', 'Cycling Cap', '2025-07-07', '86-5920601', true, '11', 1, 4],107  [false, 'Roodel', 'United States', 'Full-Finger Gloves', '2025-01-13', '48-1055459', true, '41', 6, 4],108  [false, 'Zoovu', 'China', 'Half-Finger Gloves', '2025-06-03', '12-7842022', true, '144', 6, 1],109  [false, 'Photofeed', 'China', 'HL Mountain Frame', '2025-07-14', '94-5088099', true, '106', 1, 4],110];111const example = document.getElementById('exampleTheme');112const isDark = document.documentElement.getAttribute('data-theme') === 'dark';113const hotInstance = new Handsontable(example, {114  theme: getTheme('horizon').setColorScheme(isDark ? 'dark' : 'light'),115  data,116  height: 450,117  colWidths: [180, 220, 140, 120, 120, 120, 140],118  colHeaders: ['Company Name', 'Name', 'Sell date', 'In stock', 'Quantity', 'Order ID', 'Country'],119  contextMenu: [120    'cut',121    'copy',122    '---------',123    'row_above',124    'row_below',125    'remove_row',126    '---------',127    'alignment',128    'make_read_only',129    'clear_column',130  ],131  columns: [132    {133      data: 1,134      type: 'text',135      headerClassName: 'htLeft',136    },137    {138      data: 3,139      type: 'text',140      headerClassName: 'htLeft',141    },142    {143      data: 4,144      type: 'intl-date',145      locale: 'en-GB',146      dateFormat: { day: '2-digit', month: '2-digit', year: 'numeric' },147      headerClassName: 'htLeft',148    },149    {150      data: 6,151      type: 'checkbox',152      className: 'htCenter',153      headerClassName: 'htLeft',154    },155    {156      data: 7,157      type: 'numeric',158      headerClassName: 'htLeft',159    },160    {161      data: 5,162      type: 'text',163      headerClassName: 'htLeft',164    },165    {166      data: 2,167      type: 'text',168      headerClassName: 'htLeft',169    },170  ],171  dropdownMenu: true,172  hiddenColumns: {173    indicators: true,174  },175  multiColumnSorting: true,176  filters: true,177  rowHeaders: true,178  manualRowMove: true,179  headerClassName: 'htLeft',180  autoWrapRow: true,181  autoWrapCol: true,182  manualRowResize: true,183  manualColumnResize: true,184  navigableHeaders: true,185  licenseKey: 'non-commercial-and-evaluation',186});187
188// Theme dropdown189const dropdown = document.getElementById('themeDropdown');190const trigger = document.getElementById('themeTrigger');191const triggerLabel = document.getElementById('triggerLabel');192const triggerColors = document.getElementById('triggerColors');193const menu = document.getElementById('themeMenu');194const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark'195  ? 'horizon-dark'196  : 'horizon-light';197
198const setTheme = (value) => {199  const [themeName, colorScheme] = value.split('-');200
201  hotInstance.updateSettings({ theme: getTheme(themeName).setColorScheme(colorScheme || 'auto') });202
203  // Propagate the selected color scheme to the container so the docs CSS can read it204  // via data-color-scheme and apply the right color-scheme property with higher specificity205  // than the static ht-theme-*.css declarations.206  example.dataset.colorScheme = colorScheme || 'auto';207
208  // Update trigger label209  const item = menu.querySelector(`[data-value="${value}"]`);210
211  if (item) {212    triggerLabel.textContent = item.textContent.trim();213  }214
215  // Update trigger color dots by resolving computed grid styles216  const hotRoot = document.querySelector('#exampleTheme .handsontable');217
218  if (hotRoot) {219    const helper = document.createElement('div');220
221    helper.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';222    hotRoot.appendChild(helper);223
224    const resolve = (varName) => {225      helper.style.color = `var(${varName})`;226
227      return getComputedStyle(helper).color;228    };229
230    const fg = resolve('--ht-foreground-color');231    const bg = resolve('--ht-background-color');232    const accent = resolve('--ht-accent-color');233
234    hotRoot.removeChild(helper);235
236    const dots = triggerColors.querySelectorAll('.color');237
238    if (dots.length >= 3) {239      dots[0].style.background = fg;240      dots[1].style.background = bg;241      dots[2].style.background = accent;242    }243  }244
245  // Update aria-selected246  menu.querySelectorAll('li').forEach((li) => {247    li.setAttribute('aria-selected', li.dataset.value === value ? 'true' : 'false');248  });249};250
251// Toggle dropdown252trigger.addEventListener('click', () => {253  const isOpen = !menu.hidden;254
255  menu.hidden = isOpen;256  trigger.setAttribute('aria-expanded', String(!isOpen));257});258
259// Select item260menu.addEventListener('click', (e) => {261  const item = e.target.closest('li[data-value]');262
263  if (item) {264    setTheme(item.dataset.value);265    menu.hidden = true;266    trigger.setAttribute('aria-expanded', 'false');267  }268});269
270// Close on outside click271document.addEventListener('click', (e) => {272  if (!dropdown.contains(e.target)) {273    menu.hidden = true;274    trigger.setAttribute('aria-expanded', 'false');275  }276});277
278// Close on Escape279document.addEventListener('keydown', (e) => {280  if (e.key === 'Escape' && !menu.hidden) {281    menu.hidden = true;282    trigger.setAttribute('aria-expanded', 'false');283    trigger.focus();284  }285});286
287// Set initial theme288setTheme(currentTheme);
```

Example 2 (sql):
```sql
1import Handsontable from 'handsontable';2import { mainTheme, horizonTheme, classicTheme, registerTheme, getTheme } from 'handsontable/themes';3import { PredefinedMenuItemKey } from 'handsontable/plugins/contextMenu';4
5registerTheme(mainTheme);6registerTheme(horizonTheme);7registerTheme(classicTheme);8
103 collapsed lines9// constants.js10export const data: (string | number | boolean)[][] = [11  [false, 'Tagcat', 'United Kingdom', 'Classic Vest', '2025-10-11', '01-2331942', true, '172', 2, 2],12  [true, 'Zoomzone', 'Indonesia', 'Cycling Cap', '2025-05-03', '88-2768633', true, '188', 6, 2],13  [true, 'Meeveo', 'United States', 'Full-Finger Gloves', '2025-03-27', '51-6775945', true, '162', 1, 3],14  [false, 'Buzzdog', 'Philippines', 'HL Mountain Frame', '2025-08-29', '44-4028109', true, '133', 7, 1],15  [true, 'Katz', 'India', 'Half-Finger Gloves', '2025-10-02', '08-2758492', true, '87', 1, 3],16  [false, 'Jaxbean', 'China', 'HL Road Frame', '2025-09-28', '84-3557705', false, '26', 8, 1],17  [false, 'Wikido', 'Brazil', 'HL Touring Frame', '2025-06-24', '20-9397637', false, '110', 4, 1],18  [false, 'Browsedrive', 'United States', 'LL Mountain Frame', '2025-03-13', '36-0079556', true, '50', 4, 4],19  [false, 'Twinder', 'United Kingdom', 'LL Road Frame', '2025-04-06', '41-1489542', false, '160', 6, 1],20  [false, 'Jetwire', 'China', 'LL Touring Frame', '2025-02-01', '37-1531629', true, '30', 8, 5],21  [false, 'Chatterpoint', 'China', 'Long-Sleeve Logo Jersey', '2025-07-14', '25-5083429', true, '39', 7, 2],22  [false, 'Twinder', 'Egypt', "Men's Bib-Shorts", '2025-08-31', '04-4281278', false, '96', 6, 1],23  [false, 'Midel', 'United States', "Men's Sports Shorts", '2025-06-27', '55-1711908', true, '108', 10, 3],24  [false, 'Yodo', 'India', 'ML Mountain Frame', '2025-03-16', '58-8360815', false, '46', 1, 1],25  [false, 'Camido', 'Russia', 'ML Mountain Frame-W', '2025-09-13', '10-3786104', true, '97', 8, 3],26  [false, 'Eire', 'Thailand', 'ML Road Frame', '2025-04-10', '45-1186054', true, '161', 1, 4],27  [false, 'Vinte', 'United Kingdom', 'ML Road Frame-W', '2025-01-22', '62-6202742', true, '58', 4, 3],28  [false, 'Twitterlist', 'China', 'Mountain Bike Socks', '2025-11-09', '88-9646223', true, '92', 8, 3],29  [false, 'Eidel', 'Bangladesh', 'Mountain-100', '2025-09-19', '45-5588112', true, '5', 6, 5],30  [false, 'Trunyx', 'Nigeria', 'Mountain-200', '2025-03-09', '66-6271819', true, '158', 4, 1],31  [false, 'Katz', 'Turkey', 'Mountain-300', '2025-03-05', '38-9245023', false, '121', 5, 4],32  [false, 'Kaymbo', 'United States', 'Mountain-400-W', '2025-12-24', '44-5916927', false, '61', 5, 4],33  [false, 'Ozu', 'Pakistan', 'Mountain-500', '2025-06-13', '31-5449914', true, '155', 2, 2],34  [false, 'Rhynyx', 'India', 'Racing Socks', '2025-12-05', '19-9413869', true, '162', 2, 4],35  [false, 'Flashset', 'Iran', 'Road-150', '2025-12-14', '25-9807605', false, '46', 7, 1],36  [false, 'Yata', 'Congo (Kinshasa)', 'Road-250', '2025-06-12', '74-4291983', true, '47', 4, 4],37  [false, 'Brainlounge', 'Vietnam', 'Road-350-W', '2025-03-10', '83-0980643', true, '104', 2, 3],38  [false, 'Babblestorm', 'United States', 'Road-450', '2025-10-10', '19-2878430', true, '101', 6, 4],39  [false, 'Youspan', 'Brazil', 'Road-550-W', '2025-12-16', '19-1838230', true, '150', 10, 3],40  [false, 'Nlounge', 'China', 'Road-650', '2025-10-31', '32-2267938', true, '42', 4, 2],41  [false, 'Twinte', 'India', 'Road-750', '2025-08-17', '79-2821972', true, '144', 9, 3],42  [false, 'Oyonder', 'United Kingdom', 'Short-Sleeve Classic Jersey', '2025-12-04', '46-6597557', true, '195', 4, 1],43  [false, 'Gigabox', 'Pakistan', 'Sport-100', '2025-02-03', '15-1793960', true, '199', 4, 4],44  [false, 'Livetube', 'France', 'Touring-1000', '2025-05-16', '86-0811003', true, '110', 4, 5],45  [false, 'Voomm', 'United Kingdom', 'Touring-2000', '2025-07-15', '95-3068680', true, '51', 4, 4],46  [false, 'Voonyx', 'China', 'Touring-3000', '2025-11-27', '35-3085360', false, '69', 2, 5],47  [false, 'Zoombeat', 'United States', "Women's Mountain Shorts", '2025-11-03', '56-8673088', false, '53', 2, 3],48  [false, 'Roomm', 'China', "Women's Tights", '2025-03-16', '76-0085918', true, '168', 1, 1],49  [false, 'Leenti', 'China', 'Mountain-400', '2025-05-16', '03-0893276', false, '58', 1, 4],50  [false, 'Jetpulse', 'United States', 'Road-550', '2025-02-08', '79-9013306', true, '152', 9, 3],51  [false, 'Katz', 'Peru', 'Road-350', '2025-02-15', '55-7799920', true, '66', 4, 2],52  [false, 'Cogidoo', 'India', 'LL Mountain Front Wheel', '2025-06-04', '07-0881122', false, '112', 9, 2],53  [false, 'Divavu', 'Colombia', 'Touring Rear Wheel', '2025-02-24', '58-6157387', true, '50', 10, 4],54  [false, 'Mydeo', 'China', 'Touring Front Wheel', '2025-12-07', '12-2810010', false, '31', 3, 5],55  [false, 'Browsebug', 'Japan', 'ML Mountain Front Wheel', '2025-01-14', '64-9249984', true, '132', 5, 5],56  [false, 'Layo', 'China', 'HL Mountain Front Wheel', '2025-04-24', '45-0739652', true, '45', 1, 5],57  [false, 'Snaptags', 'United Kingdom', 'LL Touring Handlebars', '2025-08-06', '09-5712761', true, '197', 4, 2],58  [false, 'Cogilith', 'China', 'HL Touring Handlebars', '2025-05-31', '01-7345008', true, '190', 4, 3],59  [false, 'Reallinks', 'United Kingdom', 'LL Road Front Wheel', '2025-05-14', '62-1065350', true, '184', 3, 4],60  [false, 'Quaxo', 'United States', 'ML Road Front Wheel', '2025-03-23', '44-7241323', true, '169', 3, 4],61  [false, 'Devify', 'China', 'HL Road Front Wheel', '2025-12-12', '52-0295699', false, '152', 4, 4],62  [false, 'Youopia', 'Angola', 'LL Mountain Handlebars', '2025-04-01', '52-2650922', false, '182', 6, 4],63  [false, 'Ainyx', 'China', 'Touring Pedal', '2025-02-27', '48-3618525', true, '141', 6, 1],64  [false, 'Browsetype', 'Malaysia', 'ML Mountain Handlebars', '2025-04-28', '51-8893923', true, '169', 7, 1],65  [false, 'Muxo', 'China', 'HL Mountain Handlebars', '2025-08-22', '68-5911361', false, '39', 7, 1],66  [false, 'Bubbletube', 'China', 'LL Road Handlebars', '2025-10-04', '41-5880042', true, '71', 8, 3],67  [false, 'Fadeo', 'Vietnam', 'ML Road Handlebars', '2025-04-23', '90-5913983', true, '148', 10, 3],68  [false, 'Yadel', 'United Kingdom', 'HL Road Handlebars', '2025-04-18', '92-0960699', true, '116', 8, 1],69  [false, 'Blognation', 'China', 'LL Headset', '2025-01-10', '06-9493898', true, '96', 10, 1],70  [false, 'Devpoint', 'China', 'ML Headset', '2025-12-25', '69-5878565', true, '35', 4, 2],71  [false, 'Aibox', 'United Kingdom', 'HL Headset', '2025-03-18', '13-1133017', true, '16', 8, 2],72  [false, 'Brightdog', 'China', 'LL Mountain Pedal', '2025-09-11', '39-6530433', true, '194', 2, 5],73  [false, 'Gabcube', 'Nigeria', 'ML Mountain Pedal', '2025-04-22', '96-6860388', true, '24', 1, 3],74  [false, 'Muxo', 'China', 'HL Mountain Pedal', '2025-06-05', '30-0356137', true, '170', 4, 4],75  [false, 'Tambee', 'China', 'ML Touring Seat/Saddle', '2025-02-22', '93-9058255', true, '184', 9, 5],76  [false, 'Cogilith', 'India', 'LL Touring Seat/Saddle', '2025-04-06', '82-9268909', false, '153', 10, 4],77  [false, 'Dynabox', 'Hong Kong', 'HL Touring Seat/Saddle', '2025-01-10', '20-6913815', false, '88', 10, 1],78  [false, 'Shuffledrive', 'Sudan', 'LL Road Pedal', '2025-09-16', '08-8238817', true, '57', 9, 2],79  [false, 'Fivechat', 'China', 'ML Road Pedal', '2025-08-26', '44-7370350', false, '62', 4, 1],80  [false, 'Meembee', 'United States', 'HL Road Pedal', '2025-12-27', '01-3525949', true, '123', 2, 4],81  [false, 'Dynazzy', 'United Kingdom', 'LL Mountain Seat/Saddle 1', '2025-12-15', '04-2414623', true, '77', 10, 5],82  [false, 'Eare', 'China', 'ML Mountain Seat/Saddle 1', '2025-04-04', '15-1917509', false, '199', 9, 4],83  [false, 'Yozio', 'China', 'HL Mountain Seat/Saddle 1', '2025-03-15', '06-2526845', true, '149', 8, 2],84  [false, 'Quinu', "Xi'an", '425-777-7829', '2025-02-22', '83-1713558', false, '191', 9, 5],85  [false, 'Jazzy', 'United Kingdom', 'ML Road Seat/Saddle 1', '2025-08-07', '00-8892524', true, '150', 10, 2],86  [false, 'Thoughtsphere', 'China', 'HL Road Seat/Saddle 1', '2025-11-28', '39-5538991', true, '130', 7, 3],87  [false, 'Leenti', 'China', 'ML Road Rear Wheel', '2025-12-29', '06-9002973', true, '179', 1, 2],88  [false, 'Quaxo', 'United Kingdom', 'HL Road Rear Wheel', '2025-09-06', '73-6104901', true, '98', 5, 3],89  [false, 'Tanoodle', 'Chile', 'LL Mountain Seat/Saddle 2', '2025-05-24', '68-7384479', true, '175', 2, 3],90  [false, 'Feednation', 'China', 'ML Mountain Seat/Saddle 2', '2025-11-21', '26-7757763', true, '11', 1, 3],91  [false, 'Kayveo', 'China', 'HL Mountain Seat/Saddle 2', '2025-06-21', '07-4873562', false, '184', 7, 4],92  [false, 'Meevee', 'Saudi Arabia', 'LL Road Seat/Saddle 1', '2025-11-16', '46-5819554', false, '27', 9, 3],93  [false, 'Twitterworks', 'China', 'ML Road Seat/Saddle 2', '2025-04-19', '01-2666826', true, '186', 3, 2],94  [false, 'Wikizz', 'Tanzania', 'HL Road Seat/Saddle 2', '2025-03-08', '54-7090503', true, '20', 3, 3],95  [false, 'Yoveo', 'United States', 'LL Mountain Tire', '2025-10-14', '78-7658520', false, '153', 2, 1],96  [false, 'Yakidoo', 'China', 'ML Mountain Tire', '2025-10-12', '23-9926318', true, '161', 8, 5],97  [false, 'Oyope', 'China', 'HL Mountain Tire', '2025-09-20', '20-0179517', true, '98', 10, 5],98  [false, 'Skipstorm', 'United States', 'LL Road Tire', '2025-10-01', '02-9543343', true, '30', 7, 3],99  [false, 'Minyx', 'United States', 'ML Road Tire', '2025-07-07', '98-3938169', true, '73', 10, 2],100  [false, 'Miboo', 'China', 'HL Road Tire', '2025-07-25', '68-5197934', true, '158', 9, 1],101  [false, 'Realfire', 'United States', 'Touring Tire', '2025-08-27', '39-8260460', true, '122', 5, 2],102  [false, 'Shufflester', 'China', 'Mountain Tire Tube', '2025-06-08', '45-9776170', true, '33', 2, 4],103  [false, 'Ntag', 'China', 'Road Tire Tube', '2025-12-06', '45-0858451', true, '107', 6, 2],104  [false, 'Jabberbean', 'United States', 'Touring Tire Tube', '2025-04-26', '15-4247305', true, '15', 1, 2],105  [false, 'Thoughtblab', 'China', 'LL Bottom Bracket', '2025-05-21', '15-8534931', true, '168', 5, 2],106  [false, 'Jabbertype', 'China', 'Classic Vest', '2025-07-25', '23-1251557', true, '135', 4, 2],107  [false, 'Buzzshare', 'United Kingdom', 'Cycling Cap', '2025-07-07', '86-5920601', true, '11', 1, 4],108  [false, 'Roodel', 'United States', 'Full-Finger Gloves', '2025-01-13', '48-1055459', true, '41', 6, 4],109  [false, 'Zoovu', 'China', 'Half-Finger Gloves', '2025-06-03', '12-7842022', true, '144', 6, 1],110  [false, 'Photofeed', 'China', 'HL Mountain Frame', '2025-07-14', '94-5088099', true, '106', 1, 4],111];112
113const example = document.getElementById('exampleTheme')!;114const isDark = document.documentElement.getAttribute('data-theme') === 'dark';115
116const hotInstance = new Handsontable(example, {117  theme: getTheme('horizon').setColorScheme(isDark ? 'dark' : 'light'),118  data,119  height: 450,120  colWidths: [180, 220, 140, 120, 120, 120, 140],121  colHeaders: ['Company Name', 'Name', 'Sell date', 'In stock', 'Quantity', 'Order ID', 'Country'],122  contextMenu: [123    'cut',124    'copy',125    '---------',126    'row_above',127    'row_below',128    'remove_row',129    '---------',130    'alignment',131    'make_read_only',132    'clear_column',133  ] as PredefinedMenuItemKey[],134  columns: [135    {136      data: 1,137      type: 'text',138      headerClassName: 'htLeft',139    },140    {141      data: 3,142      type: 'text',143      headerClassName: 'htLeft',144    },145    {146      data: 4,147      type: 'intl-date',148      locale: 'en-GB',149      dateFormat: { day: '2-digit', month: '2-digit', year: 'numeric' },150      headerClassName: 'htLeft',151    },152    {153      data: 6,154      type: 'checkbox',155      className: 'htCenter',156      headerClassName: 'htLeft',157    },158    {159      data: 7,160      type: 'numeric',161      headerClassName: 'htLeft',162    },163    {164      data: 5,165      type: 'text',166      headerClassName: 'htLeft',167    },168    {169      data: 2,170      type: 'text',171      headerClassName: 'htLeft',172    },173  ],174  dropdownMenu: true,175  hiddenColumns: {176    indicators: true,177  },178  multiColumnSorting: true,179  filters: true,180  rowHeaders: true,181  manualRowMove: true,182  headerClassName: 'htLeft',183  autoWrapRow: true,184  autoWrapCol: true,185  manualRowResize: true,186  manualColumnResize: true,187  navigableHeaders: true,188  licenseKey: 'non-commercial-and-evaluation',189});190
191// Theme dropdown192const dropdown = document.getElementById('themeDropdown')!;193const trigger = document.getElementById('themeTrigger')!;194const triggerLabel = document.getElementById('triggerLabel')!;195const triggerColors = document.getElementById('triggerColors')!;196const menu = document.getElementById('themeMenu')!;197const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark'198  ? 'horizon-dark'199  : 'horizon-light';200
201const setTheme = (value: string) => {202  const [themeName, colorScheme] = value.split('-');203
204  hotInstance.updateSettings({ theme: getTheme(themeName).setColorScheme(colorScheme || 'auto') });205  example.dataset.colorScheme = colorScheme || 'auto';206
207  // Update trigger label208  const item = menu.querySelector(`[data-value="${value}"]`);209
210  if (item) {211    triggerLabel.textContent = item.textContent!.trim();212  }213
214  // Update trigger color dots by resolving computed grid styles215  const hotRoot = document.querySelector('#exampleTheme .handsontable');216
217  if (hotRoot) {218    const helper = document.createElement('div');219
220    helper.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';221    hotRoot.appendChild(helper);222
223    const resolve = (varName: string) => {224      helper.style.color = `var(${varName})`;225
226      return getComputedStyle(helper).color;227    };228
229    const fg = resolve('--ht-foreground-color');230    const bg = resolve('--ht-background-color');231    const accent = resolve('--ht-accent-color');232
233    hotRoot.removeChild(helper);234
235    const dots = triggerColors.querySelectorAll<HTMLElement>('.color');236
237    if (dots.length >= 3) {238      dots[0].style.background = fg;239      dots[1].style.background = bg;240      dots[2].style.background = accent;241    }242  }243
244  // Update aria-selected245  menu.querySelectorAll('li').forEach((li) => {246    li.setAttribute('aria-selected', (li as HTMLElement).dataset.value === value ? 'true' : 'false');247  });248};249
250// Toggle dropdown251trigger.addEventListener('click', () => {252  const isOpen = !menu.hidden;253
254  menu.hidden = isOpen;255  trigger.setAttribute('aria-expanded', String(!isOpen));256});257
258// Select item259menu.addEventListener('click', (e) => {260  const item = (e.target as HTMLElement).closest('li[data-value]') as HTMLElement | null;261
262  if (item) {263    setTheme(item.dataset.value!);264    menu.hidden = true;265    trigger.setAttribute('aria-expanded', 'false');266  }267});268
269// Close on outside click270document.addEventListener('click', (e) => {271  if (!dropdown.contains(e.target as Node)) {272    menu.hidden = true;273    trigger.setAttribute('aria-expanded', 'false');274  }275});276
277// Close on Escape278document.addEventListener('keydown', (e) => {279  if (e.key === 'Escape' && !menu.hidden) {280    menu.hidden = true;281    trigger.setAttribute('aria-expanded', 'false');282    trigger.focus();283  }284});285
286// Set initial theme287setTheme(currentTheme);
```

Example 3 (jsx):
```jsx
1<div class="example-controls-container">2  <div class="controls">3    <div class="theme-dropdown" id="themeDropdown">4      <button class="theme-dropdown-trigger" id="themeTrigger" type="button" aria-haspopup="listbox" aria-expanded="false">5        <span class="theme-dropdown-colors" id="triggerColors">6          <span class="color"></span>7          <span class="color"></span>8          <span class="color"></span>9        </span>10        <span class="theme-dropdown-label" id="triggerLabel">Horizon Light</span>11        <svg class="theme-dropdown-chevron" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6l6 -6"/></svg>12      </button>13      <ul class="theme-dropdown-menu" id="themeMenu" role="listbox" hidden>14        <li role="option" data-value="main-light">15          <span class="theme-dropdown-colors ht-theme-main"><span class="color" style="background: var(--ht-foreground-color);"></span><span class="color" style="background: var(--ht-background-color);"></span><span class="color" style="background: var(--ht-accent-color);"></span></span>16          Main Light17        </li>18        <li role="option" data-value="main-dark">19          <span class="theme-dropdown-colors ht-theme-main-dark"><span class="color" style="background: var(--ht-foreground-color);"></span><span class="color" style="background: var(--ht-background-color);"></span><span class="color" style="background: var(--ht-accent-color);"></span></span>20          Main Dark21        </li>22        <li role="option" data-value="horizon-light">23          <span class="theme-dropdown-colors ht-theme-horizon"><span class="color" style="background: var(--ht-foreground-color);"></span><span class="color" style="background: var(--ht-background-color);"></span><span class="color" style="background: var(--ht-accent-color);"></span></span>24          Horizon Light25        </li>26        <li role="option" data-value="horizon-dark">27          <span class="theme-dropdown-colors ht-theme-horizon-dark"><span class="color" style="background: var(--ht-foreground-color);"></span><span class="color" style="background: var(--ht-background-color);"></span><span class="color" style="background: var(--ht-accent-color);"></span></span>28          Horizon Dark29        </li>30        <li role="option" data-value="classic-light">31          <span class="theme-dropdown-colors ht-theme-classic"><span class="color" style="background: var(--ht-foreground-color);"></span><span class="color" style="background: var(--ht-background-color);"></span><span class="color" style="background: var(--ht-accent-color);"></span></span>32          Classic Light33        </li>34        <li role="option" data-value="classic-dark">35          <span class="theme-dropdown-colors ht-theme-classic-dark"><span class="color" style="background: var(--ht-foreground-color);"></span><span class="color" style="background: var(--ht-background-color);"></span><span class="color" style="background: var(--ht-accent-color);"></span></span>36          Classic Dark37        </li>38      </ul>39    </div>40  </div>41</div>42
43<div id="exampleTheme" class="disable-auto-theme"></div>
```

Example 4 (csharp):
```csharp
1/* Theme dropdown */2.theme-dropdown {3  position: relative;4  display: inline-flex;5  align-items: center;6}7
8.theme-dropdown-trigger {9  display: inline-flex;10  align-items: center;11  gap: 0.5rem;12  background: none;13  border: 1px solid var(--sl-color-gray-5, #e0e0e0);14  color: var(--sl-color-gray-2, #555555);15  cursor: pointer;16  font-size: var(--sl-text-sm, 0.875rem);17  font-weight: 500;18  padding: 0.4rem 0.625rem;19  transition: color 0.15s, background-color 0.15s;20  white-space: nowrap;21  border-radius: 0;22}23
24.theme-dropdown-trigger:hover {25  color: var(--sl-color-white, #333333);26  background: var(--sl-color-gray-7, var(--sl-color-gray-6, #eeeeee));27}28
29.theme-dropdown-chevron {30  flex-shrink: 0;31  margin-inline-start: 0.15rem;32  transition: transform 0.15s;33}34
35.theme-dropdown-trigger[aria-expanded='true'] .theme-dropdown-chevron {36  transform: rotate(180deg);37}38
39.theme-dropdown-menu {40  background: var(--sl-color-bg-nav, #ffffff);41  border: 1px solid var(--sl-color-gray-5, #e0e0e0);42  border-radius: 0;43  box-shadow: none;44  inset-inline-start: 0;45  list-style: none;46  margin: 0;47  min-width: 100%;48  overflow-y: auto;49  padding: 0;50  position: absolute;51  top: 100%;52  z-index: 9999;53}54
55.theme-dropdown-menu[hidden] {56  display: none !important;57}58
59.theme-dropdown-menu li {60  align-items: center;61  color: var(--sl-color-text, #333333);62  display: flex;63  font-size: var(--sl-text-sm, 0.875rem);64  gap: 0.5rem;65  padding: 0.5rem 0.75rem;66  cursor: pointer;67  border-bottom: 1px solid var(--sl-color-gray-5, #e0e0e0);68  transition: background 0.1s, color 0.1s;69  white-space: nowrap;70  list-style: none;71  margin: 0;72}73
74.theme-dropdown-menu li .theme-dropdown-colors {75  display: none;76}77
78.theme-dropdown-menu li:last-child {79  border-bottom: none;80}81
82.theme-dropdown-menu li:hover,83.theme-dropdown-menu li:focus-visible {84  background: var(--sl-color-gray-6, #eeeeee);85  color: var(--sl-color-white, #333333);86  outline: none;87}88
89.theme-dropdown-menu li[aria-selected='true'] {90  color: var(--sl-color-white, #333333);91  box-shadow: inset 0 0 0 1px var(--sl-color-accent, #1A42E8);92}93
94/* Color dots */95.theme-dropdown-colors {96  display: inline-flex;97  align-items: center;98  gap: 3px;99}100
101.theme-dropdown-colors .color {102  width: 8px;103  height: 8px;104  border-radius: 50%;105  border: 1px solid var(--sl-color-gray-4, #bbbbbb);106}
```

---

## Column groups | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/column-groups/

**Contents:**
- Column groups
- Nested column headers
  - Header configuration object
  - Configuration
  - Example
  - Rowspan
    - Configuration
- Collapsible headers
  - Configuration
  - Example

There is a newer version of Handsontable available. Switch to the latest version →

Group your columns, using multiple levels of nested column headers, to better reflect the structure of your data.

The NestedHeaders plugin allows you to create a nested headers structure by using the HTML colspan and rowspan attributes.

To create a header that spans multiple columns, its corresponding configuration array element should be provided as an object with label and colspan properties. The label property defines the header’s label, while the colspan property defines the number of columns that the header should cover.

To create a header that spans multiple header rows, add a rowspan property to that object. See Rowspan below.

Each nestedHeaders entry is either a string label or an object with these properties:

For defaults and full details, see the nestedHeaders API reference.

A label is written to the DOM as HTML, so a label built from user input or an external system can inject markup. Handsontable does not sanitize it by default. Set the sanitizer option, which receives nested header labels under the 'header' source. See Content sanitizing.

The rowspan property sets how many header rows a single header cell should cover. Use an integer greater than 1. Positions in lower rows that sit under that cell can use an empty string '' as a placeholder, but those placeholders are optional. Handsontable can infer covered slots when you omit them.

You can combine rowspan and colspan on the same header object. The same rules apply as for colspan only: a header cannot be wider than its parent in the hierarchy, and overlapping header definitions are not supported.

The CollapsibleColumns plugin enables columns and their headers to be collapsed/expanded.

This plugin adds multi-column headers which have buttons. Clicking these buttons will collapse or expand all “child” headers, leaving the first one visible.

The NestedHeaders plugin needs to be enabled for this to work properly.

To enable the Collapsible Columns plugin, either set the collapsibleColumns configuration option to:

By default, collapsing a group leaves its first column visible. To choose which columns stay visible in each state, add the visibleWhen property to a header in the nestedHeaders configuration. It accepts three values:

Once a group uses visibleWhen on any of its headers, the headers you leave unmarked default to 'expanded' - they are hidden when the group collapses. So you only mark the column(s) you want to keep: tag one with 'always' (stays in both states) or 'collapsed' (a summary column that appears only on collapse). At least one column of a group always stays visible, so its collapse button is never lost.

In the example below, collapse the Q1 2025 group: the per-month columns (marked 'expanded') hide and the Total column ('collapsed') appears. Expanding the group reverses it.

A group whose headers use no visibleWhen markers keeps the default behavior - collapsing leaves its first column visible. The visibleWhen property applies only to headers within a collapsible group.

When you enable the ManualColumnMove plugin, nested column headers follow their columns. Moving a column moves both its data and its header label, so the labels always describe the columns beneath them.

When a move separates the columns of a group, that group renders as more than one header. Each header covers a contiguous run of the group’s columns and repeats the group’s label. No move is blocked.

Moving an entire group relocates the group and its label as a single unit. The group can land between other groups.

When a group is both collapsible and collapsed:

By default, a group is cohesive. When you move a column into the group’s span, the group adopts that column as a member and stays a single header that grows to cover it.

Set columnDropMode: 'split' on the group’s header object to change this. A group in split mode does not adopt a foreign column - one that belongs to a different group - moved into its span. It keeps its identity and renders as several same-label banners around that column.

columnDropMode controls only whether a group absorbs columns from outside it. A group always reclaims its own columns: moving one of a group’s columns out and then back into the group’s span merges it into a single banner again, regardless of its columnDropMode.

Moving a column out of a group separates a group in either mode the same way: the group renders as more than one header, each repeating its label.

In the example below, both quarters group three months. Q1 2025 uses adopt mode (the default) and Q2 2025 uses split mode. Drag a month from Q2 2025 into the middle of Q1 2025: the Q1 2025 group adopts it and spans four columns. Drag a month from Q1 2025 into the middle of Q2 2025: the Q2 2025 group splits into two Q2 2025 banners around the inserted column. Drag a Q2 2025 month out and then back into Q2 2025: it rejoins the single banner, because it belongs to that group.

This header-focused shortcut works only when a collapsible column group header is focused. Enable navigableHeaders: true to move focus onto headers with the arrow keys. For more details, see Keyboard navigation.

Configuration options

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (css):
```css
1nestedHeaders: [2  ['A', { label: 'B', colspan: 8 }, 'C'],3  ['D', { label: 'E', colspan: 4 }, { label: 'F', colspan: 4 }, 'G'],4  ['H', { label: 'I', colspan: 2 }, { label: 'J', colspan: 2 }, { label: 'K', colspan: 2 }, { label: 'L', colspan: 2 }, 'M'],5  ['N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'],6];
```

Example 2 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example1');8
9new Handsontable(container, {10  data: [11    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1'],12    ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2'],13    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3'],14    ['A4', 'B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4', 'I4', 'J4'],15    ['A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'G5', 'H5', 'I5', 'J5'],16  ],17  colHeaders: true,18  rowHeaders: true,19  height: 'auto',20  nestedHeaders: [21    ['A', { label: 'B', colspan: 8 }, 'C'],22    ['D', { label: 'E', colspan: 4 }, { label: 'F', colspan: 4 }, 'G'],23    [24      'H',25      { label: 'I', colspan: 2 },26      { label: 'J', colspan: 2 },27      { label: 'K', colspan: 2 },28      { label: 'L', colspan: 2 },29      'M',30    ],31    ['N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'],32  ],33  autoWrapRow: true,34  autoWrapCol: true,35  licenseKey: 'non-commercial-and-evaluation',36});
```

Example 3 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example1')!;8
9new Handsontable(container, {10  data: [11    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1'],12    ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2'],13    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3'],14    ['A4', 'B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4', 'I4', 'J4'],15    ['A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'G5', 'H5', 'I5', 'J5'],16  ],17  colHeaders: true,18  rowHeaders: true,19  height: 'auto',20  nestedHeaders: [21    ['A', { label: 'B', colspan: 8 }, 'C'],22    ['D', { label: 'E', colspan: 4 }, { label: 'F', colspan: 4 }, 'G'],23    [24      'H',25      { label: 'I', colspan: 2 },26      { label: 'J', colspan: 2 },27      { label: 'K', colspan: 2 },28      { label: 'L', colspan: 2 },29      'M',30    ],31    ['N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'],32  ],33  autoWrapRow: true,34  autoWrapCol: true,35  licenseKey: 'non-commercial-and-evaluation',36});
```

Example 4 (css):
```css
1nestedHeaders: [2  [{ label: 'A', rowspan: 2 }, { label: 'B', colspan: 2 }],3  ['', 'C', 'D'],4];
```

---

## License key | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/license-key/

**Contents:**
- License key
- Overview
- Commercial license
- Non-commercial license
- Entitlement license keys
  - Trial keys
  - Subscription keys
  - Perpetual keys
- Result
- The validation process

There is a newer version of Handsontable available. Switch to the latest version →

Activate Handsontable, passing your license key in the configuration object. Use a special key for non-commercial and evaluation purposes.

Handsontable is available under Commercial and Free licenses, depending on your usage.

We require you to specify which terms apply to your usage, by passing a license key in Handsontable’s licenseKey configuration option.

If you use the paid version of Handsontable, pass the string of numbers delivered to you after the purchase. Note that the license key is a string, so you need to wrap it in quotes ''.

To use it with a framework, pass the string to a licenseKey prop:

If you use Handsontable for purposes not intended toward monetary compensation such as, but not limited to, teaching, academic research, evaluation, testing and experimentation, pass the string 'non-commercial-and-evaluation'.

With this key, the grid displays no notification of any kind, and the console stays silent, because the Non-Commercial and Evaluation License permits your usage.

Handsontable also accepts entitlement license keys. An entitlement key is plain-English text that states what you licensed, followed by a bracketed block that the grid reads:

Pass the whole key string, exactly as you received it, in the same licenseKey option:

Keys issued in the 25-character format keep working without any change.

Only the bracketed block is protected by a checksum. You can rewrap the text above it, or paste the key through an email client, and the key still works. Keep the block itself on one line, and end the key there - the block must be the last thing in the string. Space and newlines around the whole key are trimmed for you, so a key pasted with a trailing newline still works.

Each license behaves differently around its date:

A trial key is time-boxed. During the trial, the grid shows the Handsontable badge in its top-left corner. Hover over the badge to see the trial status. Once the key’s notice period begins, the console starts warning how many days remain - on a standard 45-day trial that is from day one. On the last licensed day the warning says the key expires today, because that day is still licensed in full. After the expiration date, a message opens next to the badge and below the grid, and the console reports an error. When the grace period stored in the key also passes, a blocking screen replaces the grid. To purchase a commercial license, contact our Sales Team.

The console warns you before the expiration date. How early depends on the notice period stored in your key. After the expiration date, the console reports an error. The grid itself displays no message, and it never stops working. To renew your subscription, contact our Sales Team.

The expiration date is a full calendar day in UTC. Your license runs to the end of the named day, wherever you are.

A perpetual key works like the 25-character commercial keys: its maintenance date is compared against the build date of your Handsontable version, never against the current date. You can use the versions released on or before that date indefinitely, including offline. On a newer version, the console reports an error and the grid shows a notice below the table.

Your grid is now licensed. A valid commercial key removes the license notice from the grid header.

We validate the license key to determine whether you are entitled to use the software. To do that, we compare the time between two dates. These dates come from two sources of information. One is the build date that is provided in each version of Handsontable. The other is the creation date that comes with the license key. This process does not trigger any connection to any server.

Entitlement keys extend this process. A trial or subscription key carries its expiration date inside the key, and Handsontable compares that date against the current date, in UTC. A perpetual key keeps the build-date comparison described above. No key triggers any connection to any server.

If your license key is missing, invalid, or expired, Handsontable displays a notification. Where it appears depends on the problem.

A missing or invalid key blocks the grid. Handsontable covers it with a modal that cannot be closed, and repeats the message in the console. Set a valid key to remove it. The grid is not usable until you do.

An expired key does not block anything. Its message appears below the table and in the console, and every feature keeps working.

The messages are as follows:

Shown in a blocking modal and in the console:

The license key for Handsontable is missing. Use your purchased key to activate the product. Alternatively, you can activate Handsontable to use for non-commercial purposes by passing the key: ‘non-commercial-and-evaluation’. Read more about it in the documentation or contact us at [email].

Shown in a blocking modal and in the console:

The license key for Handsontable is invalid. Read more on how to install it properly or contact us at [email].

Shown below the table and in the console:

The license key for Handsontable expired on [expiration_date], and is not valid for the installed version [handsontable_version]. Renew your license key or downgrade to a version released prior to [expiration_dates]. If you need any help, contact us at [email].

To get a commercial license key for your Handsontable copy, contact our Sales Team.

There’s no built-in method to update all existing instances automatically. You have two options:

Before creating any instances: set the key globally so every new instance picks it up.

For instances that already exist: call updateSettings() on each one, looping through them manually.

What you can do depends on your license type:

If you load a version that your license doesn’t cover, you’ll see a console warning and a watermark on the grid. To keep support and access to updates, keep your license up to date.

If your license key is expired and you update to a version of Handsontable released after it expired, you’ll see:

All features still work, but you’re not entitled to use that version under an expired license. To remove the warning and watermark, either downgrade to the last version released while your license was still active, or renew the license.

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (lua):
```lua
1const settings = {2  licenseKey: '00000-00000-00000-00000-00000',3  //... other options4}
```

Example 2 (jsx):
```jsx
1<HotTable settings={settings} licenseKey="00000-00000-00000-00000-00000" />
```

Example 3 (unknown):
```unknown
1<hot-table [settings]="settings" licenseKey="00000-00000-00000-00000-00000"></hot-table>
```

Example 4 (typescript):
```typescript
1<hot-table :settings="settings" licenseKey="00000-00000-00000-00000-00000" />
```

---

## Legacy style | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/legacy-style/

**Contents:**
- Legacy style
- Legacy styles are no longer available
- Migrate to the Classic theme
  - Option 1: Using the Theme API (recommended)
  - Option 2: Using CSS files with theme as string
    - Update your CSS imports
    - Set the theme in Handsontable configuration
  - Why migrate to Classic?
- Result

There is a newer version of Handsontable available. Switch to the latest version →

Starting from version 17.0.0, the legacy stylesheet has been removed from Handsontable. If you’re upgrading from an earlier version, you must migrate to the Classic theme.

The legacy CSS file (handsontable.full.min.css) was the default stylesheet up until version 15 (released in December 2024). In version 16.1, Handsontable introduced a new theming system with the Classic theme as a replacement. As of version 17.0.0, the legacy stylesheet has been completely removed.

If you’re upgrading from a version prior to 17.0.0, you must migrate to the Classic theme to ensure your grid displays correctly.

There are two ways to apply the Classic theme. The recommended approach is to use the Theme API with a theme object.

The Theme API allows you to import and register themes programmatically. This approach provides full access to theme customization features like density modes and color schemes.

Alternatively, you can use CSS files and pass the theme name as a string to the theme option.

Replace your existing CSS import with the base styles and Classic theme:

Or if you’re using JavaScript imports:

The Classic theme provides the same visual appearance as the legacy style, but with significant improvements:

Your grid now uses the legacy stylesheet. The visual style matches pre-14.0 Handsontable.

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (lua):
```lua
1import Handsontable from 'handsontable';2import { classicTheme } from 'handsontable/themes';3
4const hot = new Handsontable(container, {5  theme: classicTheme,6  // ... other options7});
```

Example 2 (elixir):
```elixir
1@import 'handsontable/dist/handsontable.full.min.css';2@import 'handsontable/styles/ht-theme-classic.min.css';
```

Example 3 (unknown):
```unknown
1import 'handsontable/dist/handsontable.full.min.css';2import 'handsontable/styles/ht-theme-classic.min.css';
```

Example 4 (lua):
```lua
1const hot = new Handsontable(container, {2  theme: 'ht-theme-classic',3  // ... other options4});
```

---

## Installation | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/installation/

**Contents:**
- Installation
- Overview
- Install Handsontable
  - Using a package manager
  - Install Skills for Claude Code
  - Using a CDN
- Import Handsontable’s JavaScript
  - Using CommonJS or a package manager
  - Using the script tag
- Create a container

There is a newer version of Handsontable available. Switch to the latest version →

Install Handsontable through your preferred package manager, or import Handsontable’s assets directly from a CDN.

To start using Handsontable, follow these steps:

Get Handsontable’s files in your preferred way.

To install Handsontable locally using a package manager, run one of these commands:

Skills for Claude Code give Claude AI deep knowledge of Handsontable’s APIs, so it can build, configure, and debug your grid accurately. We recommend installing them alongside Handsontable.

For more details, see Skills for Claude Code.

To get Handsontable’s files from a CDN, use the following locations:

Import Handsontable’s JavaScript into your application.

For a more optimized build, import individual parts of Handsontable's JavaScript, using modules.

If you’re using Handsontable as a CommonJS package, or as an ECMAScript module (using a package manager), import the full distribution of Handsontable as a JavaScript file.

Use your bundler’s preferred method of importing files. For example:

If you’re using Handsontable as a traditional UMD package, import the full distribution of Handsontable as a minified JavaScript file.

Use the script tag. For example, if you’re loading Handsontable’s JavaScript from a CDN:

In your HTML, add an empty div, which serves as a container for your Handsontable instance.

Now turn your container into a data grid with sample data.

Handsontable is installed and ready to use in your project. Import it and create your first grid instance.

Configuration options

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (unknown):
```unknown
1npm install handsontable
```

Example 2 (unknown):
```unknown
1yarn add handsontable
```

Example 3 (unknown):
```unknown
1pnpm add handsontable
```

Example 4 (elixir):
```elixir
1/plugin marketplace add handsontable/handsontable-skills2/plugin install handsontable-skills@handsontable-skills
```

---

## Column hiding | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/column-hiding/

**Contents:**
- Column hiding
- Overview
- Enable column hiding
- Set up column hiding
  - Specify columns hidden by default
  - Show UI indicators
  - Set up context menu items
  - Set up copy and paste behavior
- Result
- Column hiding API methods

There is a newer version of Handsontable available. Switch to the latest version →

Hide individual columns to reduce screen clutter and improve the grid’s performance.

“Hiding a column” means that the hidden column doesn’t get rendered as a DOM element.

When you’re hiding a column:

To enable column hiding, use the hiddenColumns option.

To set up your column hiding configuration, follow the steps below.

To both enable column hiding and specify columns hidden by default, set the hiddenColumns configuration option to an object.

In the object, add a columns configuration option, and set it to an array of column indexes.

Now, those columns are hidden by default:

To easily see which columns are currently hidden, display UI indicators.

To enable the UI indicators, in the hiddenColumns object, set the indicators property to true:

If you use both the NestedHeaders plugin and the HiddenColumns plugin, you also need to set the colHeaders property to true. Otherwise, indicators won't work.

To easily hide and unhide columns, add column hiding items to Handsontable’s context menu.

Enable both the ContextMenu plugin and the HiddenColumns plugin. Now, the context menu automatically displays additional items for hiding and unhiding columns.

You can also add the column hiding menu items individually, by adding the hidden_columns_show and hidden_columns_hide strings to the contextMenu parameter:

By default, hidden columns are included in copying and pasting.

To exclude hidden columns from copying and pasting, in the hiddenColumns object, set the copyPasteEnabled property to false:

After completing this guide, you can hide columns from the grid without changing source data. You can configure default hidden columns, UI indicators, context menu items, and copy-paste behavior.

For the most popular column hiding tasks, use the API methods below.

To see your changes, re-render your Handsontable instance with the render() method.

To access the HiddenColumns plugin instance, use the getPlugin() method:

To hide a single column, use the hideColumn() method:

To hide multiple columns:

To unhide a single column, use the showColumn() method:

To unhide multiple columns:

Configuration options

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example1');8
9new Handsontable(container, {10  licenseKey: 'non-commercial-and-evaluation',11  data: [12    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1', 'K1', 'L1'],13    ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2', 'K2', 'L2'],14    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3', 'K3', 'L3'],15    ['A4', 'B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4', 'I4', 'J4', 'K4', 'L4'],16    ['A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'G5', 'H5', 'I5', 'J5', 'K5', 'L5'],17  ],18  height: 'auto',19  colHeaders: true,20  rowHeaders: true,21  contextMenu: true,22  // enable the `HiddenColumns` plugin23  hiddenColumns: {24    columns: [2, 4, 6],25    indicators: true,26  },27  autoWrapRow: true,28  autoWrapCol: true,29});
```

Example 2 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example1')!;8
9new Handsontable(container, {10  licenseKey: 'non-commercial-and-evaluation',11  data: [12    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1', 'K1', 'L1'],13    ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2', 'K2', 'L2'],14    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3', 'K3', 'L3'],15    ['A4', 'B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4', 'I4', 'J4', 'K4', 'L4'],16    ['A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'G5', 'H5', 'I5', 'J5', 'K5', 'L5'],17  ],18  height: 'auto',19  colHeaders: true,20  rowHeaders: true,21  contextMenu: true,22  // enable the `HiddenColumns` plugin23  hiddenColumns: {24    columns: [2, 4, 6],25    indicators: true,26  },27  autoWrapRow: true,28  autoWrapCol: true,29});
```

Example 3 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example2');8
9new Handsontable(container, {10  licenseKey: 'non-commercial-and-evaluation',11  data: [12    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1', 'K1', 'L1'],13    ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2', 'K2', 'L2'],14    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3', 'K3', 'L3'],15    ['A4', 'B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4', 'I4', 'J4', 'K4', 'L4'],16    ['A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'G5', 'H5', 'I5', 'J5', 'K5', 'L5'],17  ],18  height: 'auto',19  colHeaders: true,20  rowHeaders: true,21  // enable the `HiddenColumns` plugin22  hiddenColumns: {23    // specify columns hidden by default24    columns: [3, 5, 9],25  },26  autoWrapRow: true,27  autoWrapCol: true,28});
```

Example 4 (sql):
```sql
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// Register all Handsontable's modules.5registerAllModules();6
7const container = document.querySelector('#example2')!;8
9new Handsontable(container, {10  licenseKey: 'non-commercial-and-evaluation',11  data: [12    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1', 'K1', 'L1'],13    ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2', 'K2', 'L2'],14    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3', 'K3', 'L3'],15    ['A4', 'B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4', 'I4', 'J4', 'K4', 'L4'],16    ['A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'G5', 'H5', 'I5', 'J5', 'K5', 'L5'],17  ],18  height: 'auto',19  colHeaders: true,20  rowHeaders: true,21  // enable the `HiddenColumns` plugin22  hiddenColumns: {23    // specify columns hidden by default24    columns: [3, 5, 9],25  },26  autoWrapRow: true,27  autoWrapCol: true,28});
```

---

## Design system | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/handsontable-design-system/

**Contents:**
- Design system
- Overview
- Live preview
- Use tokens to generate a theme
- Updates frequency
- Known limitations
- Related blog articles
- Troubleshooting
- Related

There is a newer version of Handsontable available. Switch to the latest version →

The Handsontable design system defines the tokens, themes, and components that control the grid visual appearance. Read this to understand how themes and CSS variables relate.

The Handsontable Design System is a complete toolkit for building, prototyping, and customizing data grids with Handsontable. It includes grid components and design tokens, making it easy to fit Handsontable into your app’s layout or customize it in ways that wouldn’t be possible without built-in features like auto layout, variables, and more.

Open the Design System in Figma

Inside the Figma file, you’ll find local variables that define all parts of the data grid — like colors, spacing, font styles, icon sizes, and more. These variables are organized into three themes: Main, Horizon and Classic each available in both light and dark mode.

You can tweak the variables however you like to match your brand or product style. Once you’re happy with the changes, export them as JSON tokens. We recommend using the Design Tokens plugin from the Figma Community — it’s straightforward and does the job well.

After exporting, use our Theme Generator, located in the Handsontable monorepo at handsontable/scripts/themes/figma, to convert your tokens into a CSS theme and JavaScript variables object that works with Handsontable. Run it with npm run generate:themes from the handsontable/ package root.

The design system is our primary reference when planning new features or redesigns, and it’s always kept up to date. In some cases, we update the design system independently of product releases to enhance consistency and streamline the design workflow.

Didn’t find what you need? Try this:

© 2012 – 2026 Handsoncode

---
