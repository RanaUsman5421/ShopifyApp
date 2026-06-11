import { Layout, LegacyCard } from '@shopify/polaris'
import React from 'react'

export function Card({title, data, productCard}) {
  return (
    <>
        <Layout.Section oneThird>
            <LegacyCard title={title} sectioned>
                <h2>{productCard && data}</h2>
            </LegacyCard>
        </Layout.Section>
    </>
  )
}
