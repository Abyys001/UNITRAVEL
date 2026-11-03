"use client"

import { Suspense } from "react"

import { RulesInner } from "@/components/visa-rules"

/** Rules whose official sources disagree on the status; customers see "unconfirmed" until staff decide (ADR-0029). */
export default function VisaConflictsPage() { return <Suspense><RulesInner conflictsOnly /></Suspense> }
