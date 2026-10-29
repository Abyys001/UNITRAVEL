import { EntryPage, entryMetadata } from "@/components/cms-article"

type Props = { params: Promise<{ locale: string; slug: string }> }

export const generateMetadata = ({ params }: Props) => entryMetadata("LEGAL", params)
export default function Page({ params }: Props) {
  return <EntryPage kind="LEGAL" params={params} />
}
