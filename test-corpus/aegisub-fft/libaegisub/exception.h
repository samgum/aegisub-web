// Build-only adapter for the reference FFT's error type; the original FFT source
// remains unchanged. Valid reference vectors never take the exception branch.
#include <stdexcept>
namespace agi { class InternalError : public std::runtime_error { public: using std::runtime_error::runtime_error; }; }
