export class ExtendedError extends Error {
  code: string
  data?: any

  constructor({ message, code, data }: { message: string, code: string, data?: any }) {
    super(message)
    this.code = code
    this.data = data
  }
}
