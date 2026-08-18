import { Link } from 'react-router-dom'
import { Container, CtaBand, Eyebrow, Faq, PageHeader, PublicShell, usePageMeta } from './shell'
import { FAQS } from './content'

const CATEGORIES = ['Meetings', 'AI', 'Integrations', 'Pricing', 'Privacy']

export function FaqPage() {
  usePageMeta(
    'FAQ — MeetMaster',
    'Answers on recording consent, transcript accuracy, supported platforms, Gmail and Calendar access, plan limits, and deleting your data.',
  )

  return (
    <PublicShell>
      <PageHeader
        eyebrow="FAQ"
        title="Questions, answered without the marketing voice"
        sub="Grouped by subject. If the answer you need is not here, contact us and we will write it down."
      />

      {/* Jump links: five categories on one page is navigable, not a wall. */}
      <div className="border-b border-slate-200">
        <Container className="flex flex-wrap gap-2 py-5">
          {CATEGORIES.map(c => (
            <a
              key={c}
              href={`#${c.toLowerCase()}`}
              className="btn-outline focus-ring inline-flex h-8 items-center px-3 text-[13px] font-medium"
            >
              {c}
            </a>
          ))}
        </Container>
      </div>

      {CATEGORIES.map(category => {
        const items = FAQS.filter(f => f.category === category)
        if (!items.length) return null
        return (
          <section key={category} aria-labelledby={category.toLowerCase()} className="border-b border-slate-200">
            <Container className="py-14 sm:py-16">
              <div data-reveal className="mb-8">
                <Eyebrow>{category}</Eyebrow>
                <h2 id={category.toLowerCase()} className="display mt-3 text-[24px] leading-tight sm:text-[28px]">
                  {category === 'AI' ? 'Transcripts and summaries' : category}
                </h2>
              </div>
              <div data-reveal>
                <Faq items={items} />
              </div>
            </Container>
          </section>
        )
      })}

      <div className="border-b border-slate-200">
        <Container className="py-10">
          <p className="text-[14px] text-slate-600">
            Still stuck?{' '}
            <Link to="/contact" className="focus-ring rounded font-medium text-accent hover:underline">Contact us</Link>
            {' '}or read the{' '}
            <Link to="/security" className="focus-ring rounded font-medium text-accent hover:underline">security page</Link>.
          </p>
        </Container>
      </div>

      <CtaBand
        title="The quickest answer is trying it"
        sub="Sign in with Google and send the bot into one meeting. Nothing to cancel afterwards."
      />
    </PublicShell>
  )
}
