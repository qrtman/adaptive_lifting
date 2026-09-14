# Apg-Dialog - Wai

**Pages:** 3

---

## Modal Dialog Example | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/dialog/

**Contents:**
- Modal Dialog Example
- Read This First
- About This Example
- Example
- Add Delivery Address
- Verification Result
- Address Added
- End of the Road!
- Accessibility Features
- Keyboard Support

This is an illustrative example of one way of using ARIA that conforms with the ARIA specification.

Following is an example implementation of the Dialog (Modal) Pattern. The below Add Delivery Address button opens a modal dialog that contains two buttons that open other dialogs. The accessibility features section explains the rationale for initial focus placement and use of aria-describedby in each dialog.

Similar examples include:

This is just a demonstration. If it were a real application, it would provide a message telling whether the entered address is valid.

For demonstration purposes, this dialog has a lot of text. It demonstrates a scenario where:

There are several ways to resolve this issue:

Please DO NOT make the element with role dialog focusable!

In this dialog, the first paragraph has tabindex=-1. The first paragraph is also contained inside the element that provides the dialog description, i.e., the element that is referenced by aria-describedby. With some screen readers, this may have one negative but relatively insignificant side effect when the dialog opens -- the first paragraph may be announced twice. Nonetheless, making the first paragraph focusable and setting the initial focus on it is the most broadly accessible option.

The address you provided has been added to your list of delivery addresses. It is ready for immediate use. If you wish to remove it, you can do so from your profile.

You activated a fake link or button that goes nowhere! The link or button is present for demonstration purposes only.

Learn how to interpret and use assistive technology support data

To copy the following HTML code, please open it in CodePen.

---

## Date Picker Dialog Example | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/

**Contents:**
- Date Picker Dialog Example
- Read This First
- About This Example
- Example
- February 2020
- Accessibility Features
- Keyboard Support
  - Choose Date Button
  - Date Picker Dialog
  - Date Picker Dialog: Month/Year Buttons

This is an illustrative example of one way of using ARIA that conforms with the ARIA specification.

The example below includes a date input field and a button that opens a date picker that implements the Dialog (Modal) Pattern. The dialog contains a calendar that uses the grid pattern to present buttons that enable the user to choose a day from the calendar. Choosing a date from the calendar closes the dialog and populates the date input field. When the dialog is opened, if the input field is empty, or does not contain a valid date, then the current date is focused in the calendar. Otherwise, the focus is placed on the day in the calendar that matches the value of the date input field.

Similar examples include:

Note: Since the names of the days of the week in the column headers are abbreviated to two characters, they may be difficult to understand when announced by a screen reader. An alternative column header name can be provided to screen readers by applying the abbr attribute to the th elements. So, each th element includes a abbr attribute containing the full spelling of the name of the day for that column.

To copy the following HTML code, please open it in CodePen.

---

## Dialog (Modal) Pattern | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/

**Contents:**
- Dialog (Modal) Pattern
- About This Pattern
- Examples
- Keyboard Interaction
  - Note
- WAI-ARIA Roles, States, and Properties
  - Note

A dialog is a window overlaid on either the primary window or another dialog window. Windows under a modal dialog are inert. That is, users cannot interact with content outside an active dialog window. Inert content outside an active dialog is typically visually obscured or dimmed so it is difficult to discern, and in some implementations, attempts to interact with the inert content cause the dialog to close.

Like non-modal dialogs, modal dialogs contain their tab sequence. That is, Tab and Shift + Tab do not move focus outside the dialog. However, unlike most non-modal dialogs, modal dialogs do not provide means for moving keyboard focus outside the dialog window without closing the dialog.

The alertdialog role is a special-case dialog role designed specifically for dialogs that divert users' attention to a brief, important message. Its usage is described in the Alert Dialog Pattern.

In the following description, the term tabbable element refers to any element with a tabindex value of zero or greater. Note that values greater than 0 are strongly discouraged.

---
