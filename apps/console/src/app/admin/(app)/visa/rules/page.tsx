"use client"

import { Suspense } from "react"

import { RulesInner } from "@/components/visa-rules"

/** Visa requirements database (ADR-0033): `/v1/admin/visa/rules`, `visa.read`; edits need `visa.write`. */
export default function VisaRulesPage() { return <Suspense><RulesInner /></Suspense> }
