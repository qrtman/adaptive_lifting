# Apg-Grid - Grid

**Pages:** 4

---

## Layout Grid Examples | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/grid/examples/layout-grids/

**Contents:**
- Layout Grid Examples
- Read This First
- About This Example
- Examples
  - Example 1: Simple List of Links
    - Related Documents
    - Notes
  - Example 2: Pill List For a List of Message Recipients
    - Notes
  - Example 3: Scrollable Search Results

This is an illustrative example of one way of using ARIA that conforms with the ARIA specification.

The following examples demonstrate how the Grid Pattern can be used to group a collection of interactive widgets into a single tab stop. In these examples, each widget, such as a link or button, is in a separate cell of the grid, and the user can navigate between them with the arrow keys. While navigating with the arrow keys, widgets receive keyboard focus and can be activated with Space or Enter.

In addition to streamlining keyboard interfaces, these grids also convey logical grouping and semantic relationships for the elements they contain. For people who can see the screen, these groupings and relationships are visually communicated with layout and other elements of the visual design. And, by navigating the logical structure that a grid widget provides, screen reader users are also able to easily perceive the same semantic relationships.

The distinguishing feature of grid that enables it to be used for grouping other widgets is that its cells are containers that preserve the semantics of their descendant elements. That is, grid cells do not override or suppress the semantics of the elements they contain. Thus, a link contained inside of a grid cell is presented to a screen reader as a link. By contrast, a link inside of a menu is presented as a menuitem, and a link inside of a listbox is presented as an option.

Similar examples include:

This example presents a list of links titled "Related Documents" in a grid.

Move keyboard focus inside a grid with arrow keys.

This focus ring means arrow key navigation is available. Press arrow keys to move inside the component. Press Tab to jump to the next component. As a reminder, an arrow keypad graphic also appears in the lower left corner of the page.

Components that support arrow keys often enable additional keys that make navigation easier, such as Home, End, Ctrl-Home, Ctrl-End, Page Up, and Page Down.

Add recipients by typing a string in the "New Recipient Name" field and pressing Enter or activating the "Add" button. See how this grid behaves as the number of elements increases.

This example demonstrates how a grid can make moving through an infinitely large data set as easy and efficient for keyboard users as it is for mouse users. It presents a hypothetical set of search results for W3C resources about WAI-ARIA.

This implementation of grid allows the following focus movement behaviors to be declared in the HTML.

The example JavaScript allows the desired focus placement and wrapping behavior to be declared in the HTML content as follows.

NOTE: The following table describes keyboard commands that move focus among grid cells. In the examples on this page, some cells contain a single focusable widget, and if a cell contains a widget, the cell is not focusable; the widget receives focus instead of the cell. So, when a description says a command moves focus to a cell, the command may either focus the cell or a widget inside the cell.

To copy the following HTML code, please open it in CodePen.

To copy the following HTML code, please open it in CodePen.

To copy the following HTML code, please open it in CodePen.

---

## Advanced Data Grid | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/grid/examples/advanced-data-grid/

**Contents:**
- Advanced Data Grid
- Read This First
- About This Example
- Example
- Accessibility Features
- Keyboard Support
- Role, Property, State, and Tabindex Attributes
- JavaScript and CSS Source Code
- HTML Source Code

This is an illustrative example of one way of using ARIA that conforms with the ARIA specification.

This example has not yet been developed. Development is described in issue 155.

This implementation of the Grid Pattern demonstrates how to implement a grid that has functionality similar to a spreadsheet.

Similar examples include:

This is the place where the reader will experience the functioning example.

The HTML in this section along with the javascript and CSS it uses demonstrate the design pattern.

Please replace this content with a list of accessibility features demonstrated in this implementation, such as:

---

## Data Grid Examples | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/grid/examples/data-grids/

**Contents:**
- Data Grid Examples
- Read This First
- About This Example
- Examples
  - Example 1: Minimal Data Grid
    - Transactions January 1 through January 6
    - Notes
  - Example 2: Sortable Data Grid With Editable Cells
    - Transactions January 1 through January 7
    - Notes

This is an illustrative example of one way of using ARIA that conforms with the ARIA specification.

Following are three example implementations of the Grid Pattern that demonstrate the keyboard interactions and ARIA features that enable accessible, interactive presentation of tabular information. Each of the following three grids presents a set of financial transactions. The first is a simple grid with minimum ARIA markup and keyboard support. The second and third implementations add advanced features, such as content editing, sort, scroll, and show/hide.

Similar examples include:

To copy the following HTML code, please open it in CodePen.

To copy the following HTML code, please open it in CodePen.

To copy the following HTML code, please open it in CodePen.

---

## Grid (Interactive Tabular Data and Layout Containers) Pattern | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/grid/

**Contents:**
- Grid (Interactive Tabular Data and Layout Containers) Pattern
- About This Pattern
- Examples
- Data Grids For Presenting Tabular Information
  - Keyboard Interaction For Data Grids
    - Note
      - Note
- Layout Grids for Grouping Widgets
  - Keyboard Interaction For Layout Grids
    - Note

A grid widget is a container that enables users to navigate the information or interactive elements it contains using directional navigation keys, such as arrow keys, Home, and End. As a generic container widget that offers flexible keyboard navigation, it can serve a wide variety of needs. It can be used for purposes as simple as grouping a collection of checkboxes or navigation links or as complex as creating a full-featured spreadsheet application. While the words "row" and "column" are used in the names of WAI-ARIA attributes and by assistive technologies when describing and presenting the logical structure of elements with the grid role, using the grid role on an element does not necessarily imply that its visual presentation is tabular.

When presenting content that is tabular, consider the following factors when choosing between implementing this grid pattern or the table pattern.

Uses of the grid pattern broadly fall into two categories: presenting tabular information (data grids) and grouping other widgets (layout grids). Even though both data grids and layout grids employ the same ARIA roles, states, and properties, differences in their content and purpose surface factors that are important to consider in keyboard interaction design. To address these factors, the following two sections describe separate keyboard interaction patterns for data and layout grids.

A grid can be used to present tabular information that has column titles, row titles, or both. The grid pattern is particularly useful if the tabular information is editable or interactive. For example, when data elements are links to more information, rather than presenting them in a static table and including the links in the tab sequence, implementing the grid pattern provides users with intuitive and efficient keyboard navigation of the grid contents as well as a shorter tab sequence for the page. A grid may also offer functions, such as cell content editing, selection, cut, copy, and paste.

In a grid, every cell contains a focusable element or is itself focusable, regardless of whether the cell content is editable or interactive. There is one exception: if column or row header cells do not provide functions, such as sort or filter, they do not need to be focusable. One reason it is important for all cells to be able to receive or contain keyboard focus is that screen readers will typically be in their application reading mode, rather than their document reading mode, when users are interacting with the grid. While in application mode, a screen reader user hears only focusable elements and content that labels focusable elements. So, screen reader users may unknowingly overlook elements contained in a grid that are either not focusable or not used to label a column or row.

The following keys provide grid navigation by moving focus among cells of the grid. Implementations of grid make these key commands available when an element in the grid has received focus, e.g., after a user has moved focus to the grid with Tab.

If a grid supports selection of cells, rows, or columns, the following keys are commonly used for these functions.

See Key Assignment Conventions for Common Functions for cut, copy, and paste key assignments.

The grid pattern can be used to group a set of interactive elements, such as links, buttons, or checkboxes. Since only one element in the entire grid is included in the tab sequence, grouping with a grid can dramatically reduce the number of tab stops on a page. This is especially valuable if scrolling through a list of elements dynamically loads more of those elements from a large data set, such as in a continuous list of suggested products on a shopping site. If elements in a list like this were in the tab sequence, keyboard users are effectively trapped in the list. If any elements in the group also have associated elements that appear on hover, the grid pattern is also useful for providing keyboard access to those contextual elements of the user interface.

Unlike grids used to present data, A grid used for layout does not necessarily have header cells for labelling rows or columns and might contain only a single row or a single column. Even if it has multiple rows and columns, it may present a single, logically homogenous set of elements. For example, a list of recipients for a message may be a grid where each cell contains a link that represents a recipient. The grid may initially have a single row but then wrap into multiple rows as recipients are added. In such circumstances, grid navigation keys may also wrap so the user can read the list from beginning to end by pressing either Right Arrow or Down Arrow. While This type of focus movement wrapping can be very helpful in a layout grid, it would be disorienting if used in a data grid, especially for users of assistive technologies.

Because arrow keys are used to move focus inside of a grid, a grid is both easier to build and use if the components it contains do not require the arrow keys to operate. If a cell contains an element like a listbox, then an extra key command to focus and activate the listbox is needed as well as a command for restoring the grid navigation functionality. Approaches to supporting this need are described in the section on Editing and Navigating Inside a Cell.

The following keys provide grid navigation by moving focus among cells of the grid. Implementations of grid make these key commands available when an element in the grid has received focus, e.g., after a user has moved focus to the grid with Tab.

It would be unusual for a layout grid to provide functions that require cell selection. If it did, though, the following keys are commonly used for these functions.

See Key Assignment Conventions for Common Functions for cut, copy, and paste key assignments.

This section describes two important aspects of keyboard interaction design shared by both data and layout grid patterns:

For assistive technology users, the quality of experience when navigating a grid heavily depends on both what a cell contains and on where keyboard focus is set. For example, if a cell contains a button and a grid navigation key places focus on the cell instead of the button, screen readers announce the button label but do not tell users a button is present.

There are two optimal cell design and focus behavior combinations:

While any combination of widgets, text, and graphics may be included in a single cell, grids that do not follow one of these two cell design and focus movement patterns add complexity for authors or users or both. The reference implementations included in the example section below demonstrate some strategies for making other cell designs as accessible as possible, but the most widely accessible experiences are likely to come by applying the above two patterns.

While navigation keys, such as arrow keys, are moving focus from cell to cell, they are not available to perform actions like operate a combobox or move an editing caret inside of a cell. The user may need keys that are used for grid navigation to operate elements inside a cell if a cell contains:

Following are common keyboard conventions for disabling and restoring grid navigation functions.

When grid navigation is disabled, conventional changes to navigation behaviors include:

---
