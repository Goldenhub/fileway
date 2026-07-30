export function TrustBar() {
  const runtimes = [
    { name: "Node.js", range: "v20+" },
    { name: "Bun", range: "v1.0+" },
    { name: "Deno", range: "v2.0+" },
    { name: "Edge Workers", range: "any" },
  ];

  return (
    <section className="bg-paper-white py-20">
      <div className="mx-auto max-w-[1200px] px-6 text-center">
        <p className="font-booton text-body-sm font-[575] text-ink-black">
          Works across every major runtime
        </p>
        <div className="mt-10 flex items-center justify-center">
          {runtimes.map((rt, i) => (
            <div key={rt.name} className="flex items-center">
              <div className="flex items-center gap-4 px-8">
                <span className="font-booton text-body-sm font-[700] text-ink-black tracking-[-0.16px]">
                  {rt.name}
                </span>
                <span className="font-booton text-caption text-ash-gray">
                  {rt.range}
                </span>
              </div>
              {i < runtimes.length - 1 && (
                <div className="h-6 w-px bg-stone" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
