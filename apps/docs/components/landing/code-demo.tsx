export function CodeDemo() {
  return (
    <section className="bg-[#000000] py-24">
      <div className="mx-auto max-w-[1200px] px-6 text-center">
        <div className="mx-auto max-w-[680px]">
          <h2 className="text-[36px] leading-[1.2] font-[400] text-[#ffffff] tracking-[-0.36px]">
            Swap drivers with one line
          </h2>
          <p className="mt-4 text-[16px] leading-[1.5] text-[#80807c] tracking-[-0.16px]">
            The same upload code works for local disk, S3-compatible storage, and Cloudinary.
            Just change the driver.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <div className="rounded-[6px] bg-[#171715] p-6 text-left">
            <div className="mb-4 flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-[#71eaee]" />
              <span className="text-[14px] text-[#ffffff]">local</span>
            </div>
            <pre className="text-[12px] leading-[1.6] text-[#d9dad3] overflow-x-auto">
              <code>{`new FilewayClient({
  driver: new LocalDriver({
    directory: "./storage"
  })
})`}</code>
            </pre>
          </div>

          <div className="rounded-[6px] bg-[#171715] p-6 text-left">
            <div className="mb-4 flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-[#71eaee]" />
              <span className="text-[14px] text-[#ffffff]">s3</span>
            </div>
            <pre className="text-[12px] leading-[1.6] text-[#d9dad3] overflow-x-auto">
              <code>{`new FilewayClient({
  driver: new S3Driver({
    bucket: "my-bucket",
    region: "us-east-1"
  })
})`}</code>
            </pre>
          </div>

          <div className="rounded-[6px] bg-[#171715] p-6 text-left">
            <div className="mb-4 flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-[#71eaee]" />
              <span className="text-[14px] text-[#ffffff]">cloudinary</span>
            </div>
            <pre className="text-[12px] leading-[1.6] text-[#d9dad3] overflow-x-auto">
              <code>{`new FilewayClient({
  driver: new CloudinaryDriver({
    cloudName: "my-cloud",
    apiKey: process.env.API_KEY,
    apiSecret: process.env.API_SECRET
  })
})`}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
