# Apg-Combobox - Combobox

**Pages:** 7

---

## Combobox Pattern | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/combobox/

**Contents:**
- Combobox Pattern
- About This Pattern
- Examples
- Keyboard Interaction
  - Combobox Keyboard Interaction
    - Note
  - Listbox Popup Keyboard Interaction
    - Note
  - Grid Popup Keyboard Interaction
    - Note

A combobox is an input widget that has an associated popup. The popup enables users to choose a value for the input from a collection. The popup may be a listbox, grid, tree, or dialog.

In some implementations, the popup presents allowed values, while in other implementations, the popup presents suggested values. Many implementations also include a third optional element -- a graphical Open button adjacent to the combobox, which indicates availability of the popup. Activating the Open button displays the popup if suggestions are available.

The combobox pattern supports several optional behaviors. The one that most shapes interaction is text input. Some comboboxes allow users to type and edit text in the combobox and others do not. If a combobox does not support text input, it is referred to as select-only, meaning the only way users can set its value is by selecting a value in the popup. For example, in some browsers, an HTML select element with size="1" is presented to assistive technologies as a combobox. Alternatively, if a combobox supports text input, it is referred to as editable. An editable combobox may either allow users to input any arbitrary value, or it may restrict its value to a discrete set of allowed values, in which case typing input serves to filter suggestions presented in the popup.

The popup is hidden by default, i.e., the default state is collapsed. The conditions that trigger expansion -- display of the popup --are specific to each implementation. Some possible conditions that trigger expansion include:

Combobox widgets are useful for acquiring user input in either of two scenarios:

The nature of possible values presented by a popup and the way they are presented is called the autocomplete behavior. Comboboxes can have one of four forms of autocomplete:

If a combobox is editable and has any form of list autocomplete, the popup may appear and disappear as the user types. For example, if the user types a two character string that triggers five suggestions to be displayed but then types a third character that forms a string that does not have any matching suggestions, the popup may close and, if present, the inline completion string disappears.

Two other widgets that are also visually compact and enable users to make a single choice from a set of discrete choices are listbox and menu button. One feature that distinguishes combobox from both listbox and menu button is that the user's choice can be presented as a value in an editable field, which gives users the ability to select some or all of the value for copying to the clipboard. Comboboxes and menu buttons can be implemented so users can explore the set of allowed choices without losing a previously made choice. That is, users can navigate the set of available choices in a combobox popup or menu and then press escape, which closes the popup or menu without changing previous input. In contrast, navigating among options in a single-select listbox immediately changes its value, and Escape does not provide an undo mechanism. Comboboxes and listboxes can be marked as required with aria-required="true", and they have an accessible name that is distinct from their value. Thus, when assistive technology users focus either a combobox or listbox in its default state, they can perceive both a name and value for the widget. However, a menu button cannot be marked required, and while it has an accessible name, it does not have a value so is not suitable for conveying the user's choice in its collapsed state.

When focus is in the combobox:

Standard single line text editing keys appropriate for the device platform:

When focus is in a listbox popup:

In a grid popup, each suggested value may be represented by either a single cell or an entire row. See notes below for how this aspect of grid design effects the keyboard interaction design and the way that selection moves in response to focus movements.

In some implementations of tree popups, some or all parent nodes may serve as suggestion category labels so may not be selectable values. See notes below for how this aspect of the design effects the way selection moves in response to focus movements.

When focus is in a vertically oriented tree popup:

When focus is in a dialog popup:

Unlike other combobox popups, dialogs do not support aria-activedescendant so DOM focus moves into the dialog from the combobox.

---

## Editable Combobox without Autocomplete Example | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-autocomplete-none/

**Contents:**
- Editable Combobox without Autocomplete Example
- Read This First
- About This Example
- Example
- Accessibility Features
- Keyboard Support
  - Textbox
  - Listbox Popup
  - Button
- Role, Property, State, and Tabindex Attributes

This is an illustrative example of one way of using ARIA that conforms with the ARIA specification.

The below combobox that enables users to choose a term from a hypothetical list of previously searched terms demonstrates the Combobox Pattern. The design pattern describes four types of autocomplete behavior. This example illustrates the autocomplete behavior known as no autocomplete. The terms that appear in the listbox popup are not related to the string that is present in the textbox. In this implementation, the listbox popup is not automatically triggered when the textbox receives focus; the list is opened when the user types a character into the textbox or through an explicit open command.

Similar examples include:

The example combobox on this page implements the following keyboard interface. Other variations and options for the keyboard interface are described in the Keyboard Interaction section of the Combobox Pattern.

NOTE: When visual focus is in the listbox, DOM focus remains on the textbox and the value of aria-activedescendant on the textbox is set to a value that refers to the listbox option that is visually indicated as focused. Where the following descriptions of keyboard commands mention focus, they are referring to the visual focus indicator. For more information about this focus management technique, see Managing Focus in Composites Using aria-activedescendant.

The button has been removed from the tab sequence of the page, but is still important to assistive technologies for mobile devices that use touch events to open the list of options.

The example combobox on this page implements the following ARIA roles, states, and properties. Information about other ways of applying ARIA roles, states, and properties is available in the Roles, States, and Properties section of the Combobox Pattern.

To copy the following HTML code, please open it in CodePen.

---

## Editable Combobox With Both List and Inline Autocomplete Example | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-autocomplete-both/

**Contents:**
- Editable Combobox With Both List and Inline Autocomplete Example
- Read This First
- About This Example
- Example
- Accessibility Features
- Keyboard Support
  - Textbox
  - Listbox Popup
  - Button
- Role, Property, State, and Tabindex Attributes

This is an illustrative example of one way of using ARIA that conforms with the ARIA specification.

The below combobox for choosing the name of a US state or territory demonstrates the Combobox Pattern. The design pattern describes four types of autocomplete behavior. This example illustrates the autocomplete behavior referred to in the pattern as list with inline completion. If the user types one or more characters in the edit box and the typed characters match the beginning of the name of one or more states or territories, a listbox popup appears containing the matching names, and the first match is automatically selected. In addition, the portion of the selected suggestion that has not been typed by the user, a completion string, appears inline after the input cursor in the textbox. The automatically selected suggestion becomes the value of the textbox when the combobox loses focus unless the user chooses a different suggestion or changes the character string in the textbox. Note that this implementation enables users to input the name of a state or territory, but it does not prevent input of any other arbitrary value.

Similar examples include:

The example combobox on this page implements the following keyboard interface. Other variations and options for the keyboard interface are described in the Keyboard Interaction section of the Combobox Pattern.

NOTE: When visual focus is in the listbox, DOM focus remains on the textbox and the value of aria-activedescendant on the textbox is set to a value that refers to the listbox option that is visually indicated as focused. Where the following descriptions of keyboard commands mention focus, they are referring to the visual focus indicator. For more information about this focus management technique, see Managing Focus in Composites Using aria-activedescendant.

The button has been removed from the tab sequence of the page, but is still important to assistive technologies for mobile devices that use touch events to open the list of options.

The example combobox on this page implements the following ARIA roles, states, and properties. Information about other ways of applying ARIA roles, states, and properties is available in the Roles, States, and Properties section of the Combobox Pattern.

To copy the following HTML code, please open it in CodePen.

---

## Date Picker Combobox Example | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-datepicker/

**Contents:**
- Date Picker Combobox Example
- Read This First
- About This Example
- Example
- December 2020
- Accessibility Features
- Keyboard Support
  - Combobox
  - Date Picker Dialog
  - Date Picker Dialog: Calendar Buttons

This is an illustrative example of one way of using ARIA that conforms with the ARIA specification.

The below date picker demonstrates an implementation of the Combobox Pattern that opens a dialog. The date picker dialog is opened by activating the choose date button or by moving keyboard focus to the combobox and pressing Down Arrow or Alt + Down Arrow. The dialog contains an implementation of the grid pattern for displaying a calendar and enabling selection of a date. Additional buttons in the dialog are available for changing the month and year shown in the grid.

Similar examples include:

Note: Since the names of the days of the week in the column headers are abbreviated to two characters, they may be difficult to understand when announced by a screen reader. An alternative column header name can be provided to screen readers by applying the abbr attribute to the th elements. So, each th element includes an abbr attribute containing the full spelling of the name of the day for that column.

To copy the following HTML code, please open it in CodePen.

---

## Editable Combobox with Grid Popup Example | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/grid-combo/

**Contents:**
- Editable Combobox with Grid Popup Example
- Read This First
- About This Example
- Example
- Accessibility Features
- Keyboard Support
  - Textbox
  - Grid Popup
- Role, Property, State, and Tabindex Attributes
  - Textbox

This is an illustrative example of one way of using ARIA that conforms with the ARIA specification.

The following example combobox implements the combobox pattern using a grid for the suggested values popup.

In this example, users can specify the name of a fruit or vegetable by either typing a value in the box or choosing from the set of values presented in a grid popup. The popup becomes available after the textbox contains a character that matches the beginning of the name of one of the items in the set of value suggestions. Users may type any value in the textbox; this implementation does not limit input to values that are in the set of value suggestions.

The grid that presents suggested values has two columns. Each row of the grid represents one suggestion; column one contains the name of the fruit or vegetable and column two identifies whether it is a fruit or vegetable.

Similar examples include:

Browsers do not manage visibility of elements referenced by aria-activedescendant like they do for elements with focus. When a keyboard event changes the active option in the listbox, the JavaScript scrolls the option referenced by aria-activedescendant into view. Managing aria-activedescendant visibility is essential to accessibility for people who use a browser's zoom feature to increase the size of content.

The example combobox on this page implements the following keyboard interface. Other variations and options for the keyboard interface are described in the Keyboard Interaction section of the combobox pattern.

NOTE: When visual focus is in the grid, DOM focus remains on the textbox and the value of aria-activedescendant on the textbox is set to a value that refers to an element in the grid that is visually indicated as focused. Where the following descriptions of keyboard commands mention focus, they are referring to the visual focus indicator. For more information about this focus management technique, see Managing Focus in Composites Using aria-activedescendant.

The example comboboxes on this page implement the following ARIA roles, states, and properties. Information about other ways of applying ARIA roles, states, and properties is available in the Roles, States, and Properties section of the combobox pattern.

To copy the following HTML code, please open it in CodePen.

---

## Select-Only Combobox Example | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/

**Contents:**
- Select-Only Combobox Example
- Read This First
- About This Example
- Example
- Accessibility Features
- Keyboard Support
  - Closed Combobox
  - Listbox Popup
- Role, Property, State, and Tabindex Attributes
  - Combobox

This is an illustrative example of one way of using ARIA that conforms with the ARIA specification.

The following example implementation of the Combobox Pattern demonstrates a single-select combobox widget that is functionally similar to an HTML select element. Unlike the editable combobox examples, this select-only combobox is not made with an <input> element, and it does not accept freeform user input. However, like an HTML <select>, users can type characters to select matching options.

Similar examples include:

While the functionality and user experience of this example are nearly equivalent to an HTML select element with the attribute size="1", the following differences in behavior are implemented to improve both accessibility and general usability.

The example combobox on this page implements the following keyboard interface. Other variations and options for the keyboard interface are described in the Keyboard Interaction section of the combobox pattern.

NOTE: When visual focus is in the listbox, DOM focus remains on the combobox and the value of aria-activedescendant on the combobox is set to a value that refers to the listbox option that is visually indicated as focused. Where the following descriptions of keyboard commands mention focus, they are referring to the visual focus indicator. For more information about this focus management technique, see Managing Focus in Composites Using aria-activedescendant.

The example combobox on this page implements the following ARIA roles, states, and properties. Information about other ways of applying ARIA roles, states, and properties is available in the Roles, States, and Properties section of the Combobox Pattern.

To copy the following HTML code, please open it in CodePen.

---

## Editable Combobox With List Autocomplete Example | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-autocomplete-list/

**Contents:**
- Editable Combobox With List Autocomplete Example
- Read This First
- About This Example
- Example
- Accessibility Features
- Keyboard Support
  - Textbox
  - Listbox Popup
  - Button
- Role, Property, State, and Tabindex Attributes

This is an illustrative example of one way of using ARIA that conforms with the ARIA specification.

The below combobox for choosing the name of a US state or territory demonstrates the Combobox Pattern. The design pattern describes four types of autocomplete behavior. This example illustrates the autocomplete behavior known as list autocomplete with manual selection. If the user types one or more characters in the edit box and the typed characters match the beginning of the name of one or more states or territories, a listbox popup appears containing the matching names. When the listbox appears, a suggested name is not automatically selected. Thus, after typing, if the user tabs or clicks out of the combobox without choosing a value from the listbox, the typed string becomes the value of the combobox. Note that this implementation enables users to input the name of a state or territory, but it does not prevent input of any other arbitrary value.

Similar examples include:

The example combobox on this page implements the following keyboard interface. Other variations and options for the keyboard interface are described in the Keyboard Interaction section of the Combobox Pattern.

NOTE: When visual focus is in the listbox, DOM focus remains on the textbox and the value of aria-activedescendant on the textbox is set to a value that refers to the listbox option that is visually indicated as focused. Where the following descriptions of keyboard commands mention focus, they are referring to the visual focus indicator. For more information about this focus management technique, see Managing Focus in Composites Using aria-activedescendant.

The button has been removed from the tab sequence of the page, but is still important to assistive technologies for mobile devices that use touch events to open the list of options.

The example combobox on this page implements the following ARIA roles, states, and properties. Information about other ways of applying ARIA roles, states, and properties is available in the Roles, States, and Properties section of the Combobox Pattern.

To copy the following HTML code, please open it in CodePen.

---
