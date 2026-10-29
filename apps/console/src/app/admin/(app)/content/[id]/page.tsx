"use client"

import { useParams } from "next/navigation"

import { ContentEditor } from "@/components/content-editor"

export default function ContentEntry() {
  const { id } = useParams<{ id: string }>()
  return <ContentEditor id={id} />
}
