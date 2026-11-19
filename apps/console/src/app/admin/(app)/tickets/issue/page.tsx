"use client"

import { Suspense } from "react"

import { ListSkeleton } from "@/components/case"
import { IssueWizard } from "@/components/tickets/issue-wizard"

export default function IssueTicketPage() {
  return <Suspense fallback={<ListSkeleton rows={4} className="px-6 pt-6" />}><IssueWizard /></Suspense>
}
