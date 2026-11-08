// A small model that uses the newer syntax: contexts, reject, typed parameters,
// notes, planned work, and a scheduled automation that reads a read model.

system BillingPlatform {
  external: stripe (payments)
  region: eu-west, us-east
  event-naming: kebab
}

actor Customer { auth: session }
actor Admin { auth: oauth }

context Billing {
  description: Invoices, refunds and reminders
  role: core
  publishes: invoice-opened, invoice-refunded

  boundary Invoice(invoiceId) @partition(shardKey="invoiceId")

  Customer -> openInvoice(accountId: id, amount: number) in Invoice(invoiceId)
    @trigger(type=ui, name="InvoicesPage", part="Open button", route="POST /invoices")
    --[the amount is not positive]--> reject AMOUNT_INVALID
    --[default]--> [invoice-opened { invoiceId, accountId, amount }]

  Admin -> refundInvoice(invoiceId: id, amount: number) in Invoice(invoiceId) @slice("Refund an invoice") @planned
  on [invoice-opened(invoiceId)]
    --[the invoice was refunded before]--> reject ALREADY_REFUNDED
    --[default]--> [invoice-refunded { invoiceId, amount }]

  view InvoiceStatus(invoiceId: id) = [invoice-opened(invoiceId), invoice-refunded*(invoiceId)] => { state: text }

  view OverdueInvoices(accountId: id) = [invoice-opened*(accountId)] => { invoiceId: id, daysLate: number }

  every 1 hours
  from [OverdueInvoices(accountId) @fresh<5m>]
    -> reminder-sender -> sendReminder(accountId)
}

context Notifications {
  description: Messages to customers
  role: adapter
  infrastructure: Email provider

  invoice-opened { invoiceId, accountId }
    -> mailer -> sendInvoiceEmail(invoiceId)
}
