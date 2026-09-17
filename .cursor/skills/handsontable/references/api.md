# Handsontable - Api

**Pages:** 2

---

## Introduction | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/api/

**Contents:**
- Introduction
- Getting help
- Related

There is a newer version of Handsontable available. Switch to the latest version →

This page describes the Handsontable API — the methods, hooks, and plugin interfaces you use to control the grid programmatically.

Welcome to Handsontable’s API reference. Our goal is to make it easy to dive in and start coding from day one.

However, data grids are rather complex libraries, so we assume that you possess a certain level of expertise in JavaScript before moving forward. If you want to grab some basics, we have provided a JavaScript example in the demo section.

The API enables you to control the data grid programmatically. With this API, you can:

This reference comprises four sections:

If you need help using the API reference, please contact our Support.

© 2012 – 2026 Handsoncode

---

## Custom ID, class, and style | Handsontable

**URL:** https://handsontable.com/docs/javascript-data-grid/custom-id-class-style/

**Contents:**
- Custom ID, class, and style
- Overview
- Set the id, class, and style
- Result

There is a newer version of Handsontable available. Switch to the latest version →

Apply a custom id, class, and inline style to the Handsontable container, to target the grid with your own CSS or JavaScript selectors.

The Handsontable container is a regular DOM element, so you can give it a custom id, class, and inline style. How you set these attributes depends on the framework you use, but two rules apply everywhere:

In the vanilla JavaScript build, the container is the DOM element you pass to the Handsontable constructor. Set its id, class, and style on that element before or after initialization.

In the following example, the container receives a custom class and an inline border. Because the element already has the id example1, Handsontable keeps it. An element with no id would instead receive a generated ht_<random> value.

The grid container has your custom class and inline style applied, so you can target it with your own CSS or JavaScript selectors. The container’s id is the one you set, or a generated ht_<random> value when none is provided.

© 2012 – 2026 Handsoncode

**Examples:**

Example 1 (php):
```php
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3// register Handsontable's modules4registerAllModules();5const container = document.querySelector('#example1');6// apply a custom class and inline style to the container element7container.classList.add('inventory-grid');8container.style.border = '1px solid #4caf50';9const data = [10    ['SKU-4821', 'Wireless Mouse', 142, 'Electronics'],11    ['SKU-0093', 'USB-C Cable', 67, 'Electronics'],12    ['SKU-1175', 'Desk Lamp', 0, 'Home Office'],13    ['SKU-3340', 'Notebook', 230, 'Stationery'],14    ['SKU-7782', 'Standing Desk', 18, 'Furniture'],15];16new Handsontable(container, {17    data,18    colHeaders: ['SKU', 'Product', 'Stock', 'Category'],19    height: 'auto',20    autoWrapRow: true,21    autoWrapCol: true,22    licenseKey: 'non-commercial-and-evaluation',23});
```

Example 2 (php):
```php
1import Handsontable from 'handsontable/base';2import { registerAllModules } from 'handsontable/registry';3
4// register Handsontable's modules5registerAllModules();6
7const container = document.querySelector('#example1')!;8
9// apply a custom class and inline style to the container element10container.classList.add('inventory-grid');11container.style.border = '1px solid #4caf50';12
13const data = [14  ['SKU-4821', 'Wireless Mouse', 142, 'Electronics'],15  ['SKU-0093', 'USB-C Cable', 67, 'Electronics'],16  ['SKU-1175', 'Desk Lamp', 0, 'Home Office'],17  ['SKU-3340', 'Notebook', 230, 'Stationery'],18  ['SKU-7782', 'Standing Desk', 18, 'Furniture'],19];20
21new Handsontable(container, {22  data,23  colHeaders: ['SKU', 'Product', 'Stock', 'Category'],24  height: 'auto',25  autoWrapRow: true,26  autoWrapCol: true,27  licenseKey: 'non-commercial-and-evaluation',28});
```

---
