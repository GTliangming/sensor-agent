import type { ReactNode } from 'react';

interface PageContainerProps {
    title: string;
    description?: string;
    extra?: ReactNode;
    children?: ReactNode;
}

export default function PageContainer({ title, description, extra, children }: PageContainerProps) {
    return (
        <div className="page-container">
            <div className="page-container__header">
                <div>
                    <h1 className="page-container__title">{title}</h1>
                    {description ? <p className="page-container__desc">{description}</p> : null}
                </div>
                {extra}
            </div>
            {children}
        </div>
    );
}
